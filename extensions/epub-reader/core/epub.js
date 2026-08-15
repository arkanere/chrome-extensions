// core/epub — the only module that knows what an EPUB is: a ZIP holding an OPF
// that names the reading order. Bytes in, spine out. Knows nothing about
// sentences, speech, or the viewer's DOM.
//
// The ZIP is read by hand rather than with a library. Phase 0 measured 113 real
// books: stored and deflate are the only compression methods any of them used,
// none was zip64, and DecompressionStream('deflate-raw') is built into Chrome.
// See section 2.5 of planned-architecture.md.

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

const CONTAINER_PATH = "META-INF/container.xml";
const ENCRYPTION_PATH = "META-INF/encryption.xml";

// ---------------------------------------------------------------- ZIP reading

// The EOCD sits at the end of the file, but up to 65535 bytes of archive comment
// may follow it, so it has to be searched for backwards.
function findEocd(view) {
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let i = 22; i <= max; i++) {
    const at = view.byteLength - i;
    if (view.getUint32(at, true) === EOCD_SIG) return at;
  }
  return -1;
}

function readCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("not a ZIP archive: no end-of-central-directory record");

  let count = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  // zip64. No test book needed this, but the check is four lines and the failure
  // without it is a silently truncated book rather than an error.
  const locator = eocd - 20;
  if (locator >= 0 && view.getUint32(locator, true) === EOCD64_LOCATOR_SIG) {
    const eocd64 = Number(view.getBigUint64(locator + 8, true));
    if (eocd64 >= 0 && eocd64 < view.byteLength && view.getUint32(eocd64, true) === EOCD64_SIG) {
      count = Number(view.getBigUint64(eocd64 + 32, true));
      cdOffset = Number(view.getBigUint64(eocd64 + 48, true));
    }
  }

  const entries = new Map();
  const decoder = new TextDecoder("utf-8");
  let p = cdOffset;

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CEN_SIG) {
      throw new Error(`damaged ZIP: central directory entry ${i} has a bad signature`);
    }

    const method = view.getUint16(p + 10, true);
    let compressedSize = view.getUint32(p + 20, true);
    let uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let localOffset = view.getUint32(p + 42, true);

    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // 0xFFFFFFFF in a size or an offset means the real value is in the zip64
    // extra field (header id 0x0001), in a fixed order, present only for the
    // fields that overflowed.
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = view.getUint16(e, true);
        const size = view.getUint16(e + 2, true);
        if (id === 0x0001) {
          let f = e + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(view.getBigUint64(f, true));
            f += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(view.getBigUint64(f, true));
            f += 8;
          }
          if (localOffset === 0xffffffff) localOffset = Number(view.getBigUint64(f, true));
          break;
        }
        e += 4 + size;
      }
    }

    // Sizes come from here and never from a data descriptor: the central
    // directory's copy is always filled in, which is why the one test book that
    // sets the data-descriptor flag needs no special handling (2.5).
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return { view, bytes, entries };
}

async function readEntry(zip, path) {
  const entry = zip.entries.get(path);
  if (!entry) return null;

  // The local header's name and extra lengths need not match the central
  // directory's, so the data offset must be computed from the local header
  // itself. Using the central directory's lengths lands mid-file on some books
  // (2.5, finding 1).
  const { view, bytes } = zip;
  const lh = entry.localOffset;
  if (view.getUint32(lh, true) !== LFH_SIG) {
    throw new Error(`damaged ZIP: ${path} has a bad local header`);
  }
  const nameLen = view.getUint16(lh + 26, true);
  const extraLen = view.getUint16(lh + 28, true);
  const start = lh + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === STORED) return raw;
  if (entry.method !== DEFLATED) {
    throw new Error(`${path}: unsupported compression method ${entry.method}`);
  }

  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------- XML helpers

// Element lookup is always by local name in any namespace. Two of the 113 test
// books prefix every OPF element (<opf:spine>, <ns0:itemref>); on those,
// getElementsByTagName returns nothing and the book opens blank rather than
// failing (2.5, finding 3).
function tags(node, name) {
  return [...node.getElementsByTagNameNS("*", name)];
}

function firstText(node, name) {
  const el = tags(node, name)[0];
  return el ? el.textContent.trim() : "";
}

function parseXml(bytes, path) {
  const doc = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(bytes), "text/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error(`${path} is not valid XML`);
  }
  return doc;
}

// Every href in an OPF is relative to the OPF's own directory, not to the root of
// the archive. Getting this wrong is the classic EPUB bug.
function resolvePath(base, href) {
  const clean = decodeURIComponent(href.split("#")[0]);
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  const out = [];
  for (const part of (dir + clean).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const CONTENT_TYPES = {
  xhtml: "application/xhtml+xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
};

// ---------------------------------------------------------------------- open

export async function open(buffer) {
  const zip = readCentralDirectory(new Uint8Array(buffer));

  const containerBytes = await readEntry(zip, CONTAINER_PATH);
  if (!containerBytes) throw new Error(`this file has no ${CONTAINER_PATH}, so it is not an EPUB`);

  const rootfile = tags(parseXml(containerBytes, CONTAINER_PATH), "rootfile")[0];
  const opfPath = rootfile && rootfile.getAttribute("full-path");
  if (!opfPath) throw new Error(`${CONTAINER_PATH} does not name a package document`);

  const opfBytes = await readEntry(zip, opfPath);
  if (!opfBytes) throw new Error(`the package document ${opfPath} is missing from the archive`);
  const opf = parseXml(opfBytes, opfPath);

  // manifest: id -> { path, mediaType }
  const manifest = new Map();
  for (const item of tags(opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      manifest.set(id, {
        path: resolvePath(opfPath, href),
        mediaType: item.getAttribute("media-type") || "",
      });
    }
  }

  // spine: the reading order, as idrefs into the manifest.
  const spineEl = tags(opf, "spine")[0];
  const spine = [];
  for (const ref of spineEl ? tags(spineEl, "itemref") : []) {
    const item = manifest.get(ref.getAttribute("idref"));
    if (!item) continue;
    spine.push({
      path: item.path,
      mediaType: item.mediaType,
      // Two test books list a chapter that is not in the archive at all. Section
      // 8 says to skip such a chapter and keep the rest of the book readable, so
      // it is recorded here rather than thrown on.
      present: zip.entries.has(item.path),
      byteLength: zip.entries.get(item.path)?.uncompressedSize ?? 0,
    });
  }
  if (!spine.length) throw new Error(`${opfPath} has an empty spine, so there is nothing to read`);

  // DRM, as distinct from font obfuscation. encryption.xml is present on readable
  // books too — it is also how Adobe font obfuscation is declared — so the test is
  // whether an *encrypted* file is one we need to read (2.5).
  let encrypted = false;
  const encryptionBytes = await readEntry(zip, ENCRYPTION_PATH);
  if (encryptionBytes) {
    const contentPaths = new Set([opfPath, ...spine.map((s) => s.path)]);
    for (const ref of tags(parseXml(encryptionBytes, ENCRYPTION_PATH), "CipherReference")) {
      const uri = ref.getAttribute("URI");
      if (uri && contentPaths.has(resolvePath("", uri))) encrypted = true;
    }
  }

  const title = firstText(opf, "title") || "";

  return {
    sectionCount: spine.length,
    title,
    encrypted,
    spine,

    // The parsed XHTML for spine item n. Content documents are XML, but a book
    // that declares text/html is parsed as HTML so its unclosed tags survive.
    async section(n) {
      const item = spine[n];
      if (!item) throw new Error(`no spine item ${n}`);
      const bytes = await readEntry(zip, item.path);
      if (!bytes) throw new Error(`chapter ${item.path} is missing from the archive`);

      const type = item.mediaType === "text/html" ? "text/html" : "application/xhtml+xml";
      const doc = new DOMParser().parseFromString(
        new TextDecoder("utf-8").decode(bytes),
        type,
      );

      // An XHTML parse error is recoverable: the same bytes read as HTML almost
      // always give the right document, and a chapter shown imperfectly beats a
      // chapter not shown.
      if (doc.getElementsByTagName("parsererror").length) {
        return new DOMParser().parseFromString(new TextDecoder("utf-8").decode(bytes), "text/html");
      }
      return doc;
    },

    // Images, fonts, stylesheets — anything the renderer needs to resolve a URL to.
    resource(path) {
      return readEntry(zip, path);
    },

    contentType(path) {
      const item = [...manifest.values()].find((m) => m.path === path);
      if (item && item.mediaType) return item.mediaType;
      const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
      return CONTENT_TYPES[ext] || "application/octet-stream";
    },

    // Exposed so the renderer can turn a relative href inside a chapter into an
    // archive path without knowing where the OPF lives.
    resolve: resolvePath,
  };
}
