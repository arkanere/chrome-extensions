// Wiring only. Builds the modules and connects them; logic belongs in the modules.

import * as source from "./core/source.js";
import * as epubReaderCore from "./core/epub.js";

const titleEl = document.getElementById("title");
const noticeEl = document.getElementById("notice");

function notice(html, isError) {
  noticeEl.hidden = false;
  noticeEl.className = isError ? "error" : "";
  noticeEl.innerHTML = html;
}

function clearNotice() {
  noticeEl.hidden = true;
}

// The interceptor appends the original URL raw, so take everything after "?src="
// literally rather than through URLSearchParams — a query string inside the book's
// URL would otherwise be split at its first "&".
function sourceUrl() {
  const marker = "?src=";
  const at = location.href.indexOf(marker);
  return at === -1 ? null : location.href.slice(at + marker.length);
}

let doc = null;
let book = null;

async function show(loaded) {
  doc = loaded;
  book = null;
  titleEl.textContent = doc.label;
  clearNotice();

  book = await epubReaderCore.open(doc.bytes);

  const label = book.title || doc.label;
  titleEl.textContent = label;
  document.title = `${label} — EPUB Reader`;

  // Section 8's DRM row. Nothing below this point would work anyway, so it stops
  // here rather than half-opening the book.
  if (book.encrypted) {
    notice("This book is DRM-protected and cannot be opened.", true);
    console.warn("[epub-reader] DRM: an encrypted content document");
    return;
  }

  const missing = book.spine.filter((s) => !s.present);
  if (missing.length) {
    notice(
      `${missing.length} of this book's ${book.sectionCount} chapters ` +
      `${missing.length === 1 ? "is" : "are"} missing from the file and will be skipped.`,
    );
  }

  console.log(
    `[epub-reader] ${label} (${doc.label}, ${doc.bytes.byteLength} bytes): ` +
    `${book.sectionCount} sections, key ${doc.key.slice(0, 12)}…. ` +
    `Run epubReader.spine() to list them.`,
  );
}

async function loadFile(file) {
  try {
    await show(await source.fromFile(file));
  } catch (err) {
    notice(`Could not open <b>${file.name}</b>: ${err.message}`, true);
    console.error("[epub-reader]", err);
  }
}

async function loadUrl(url) {
  try {
    await show(await source.fromUrl(url));
  } catch (err) {
    if (url.startsWith("file://")) {
      notice(
        `Could not read <code>${url}</code>.<br><br>Local files need the extension's ` +
        `<b>Allow access to file URLs</b> switch, on its card at <code>chrome://extensions</code>. ` +
        `Chrome cannot grant that automatically. Failing that, use <b>Open a book</b> above.`,
        true,
      );
    } else {
      notice(`Could not load this book: ${err.message}`, true);
    }
    console.error("[epub-reader]", err);
  }
}

document.getElementById("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) await loadFile(file);
});

// Drag-and-drop. Chrome downloads .epub rather than navigating to it, so a file
// already on disk is the common case and dropping it must work (section 8).
// dragover has to be cancelled or the drop never fires and Chrome navigates away.
let dragDepth = 0;

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

window.addEventListener("dragenter", () => {
  dragDepth += 1;
  document.body.classList.add("dropping");
});

// Counted rather than toggled: dragging over a child element fires dragleave on
// the parent, so a bare toggle flickers the overlay off mid-drag.
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove("dropping");
});

window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dropping");

  const file = e.dataTransfer.files[0];
  if (file) await loadFile(file);
});

// Debug mode: inspect the book from the devtools console. Not a URL flag, because
// the interceptor appends the source URL raw and anything after it would be read
// as part of that URL. It grows one entry per phase (section 0).
window.epubReader = {
  get book() {
    return book;
  },

  // epubReader.spine() — the reading order, as phase 2's exit criteria ask for it.
  spine() {
    if (!book) return console.warn("[epub-reader] no book loaded");
    console.table(
      book.spine.map((s, i) => ({
        index: i,
        path: s.path,
        mediaType: s.mediaType,
        bytes: s.byteLength,
        present: s.present,
      })),
    );
    return book.spine;
  },
};

const src = sourceUrl();
if (src) {
  console.log(`[epub-reader] opened with src=${src}`);
  loadUrl(src);
} else {
  notice("Choose <b>Open a book</b> above, or drop an EPUB anywhere on this page.");
}
