// view/renderer — puts chapters on screen, lazily, each inside its own shadow
// root. Knows nothing about speech or sentences.
//
// The shadow root is the whole point of this file (2.4). A book ships CSS written
// to control an entire page: rules for `body`, `h1`, `button`, sometimes `*`.
// Dropped into our document that CSS would restyle the header, the controls and
// the notice bar. A shadow root scopes it — the book's rules cannot reach out,
// and our rules cannot reach in, which is why each root needs its own copy of the
// reading styles.

// Chapters render as they approach the viewport. The largest test book has 224 of
// them and 14 MB of XHTML (2.5), which must not all be parsed on open.
const RENDER_MARGIN = "800px";

// A chapter is torn back down once it is this far outside the viewport, so a long
// read does not accumulate every chapter's DOM and blob URLs. Comfortably wider
// than RENDER_MARGIN so scrolling back and forth across one boundary does not
// thrash.
const KEEP_MARGIN = "2400px";

// The reading styles, injected into every shadow root. Deliberately small: it
// sets the column and the type, and leaves everything else to the book. Written
// as low-specificity rules so a book that styles its own paragraphs still wins.
const BASE_STYLES = `
  :host {
    display: block;
    padding: 3.5rem 3rem;
  }
  :where(html, body) {
    margin: 0;
    padding: 0;
    background: none;
    color: inherit;
  }
  :where(p, li, blockquote, td) {
    line-height: 1.65;
  }
  :where(img, svg, video) {
    max-width: 100%;
    height: auto;
  }
  :where(pre) {
    overflow-x: auto;
  }
  /* The book's own fonts are honoured, but its sizes are not: a book that sets
     12pt body text would ignore the header's font-size control entirely. */
  :where(body, p, li, div, td) {
    font-size: inherit;
  }
  /* Phase 6's highlight, and the only copy of these rules in the extension. The
     ranges the highlighter registers live in this shadow root, and ::highlight()
     styling resolves against the tree the range is in: recolouring this rule
     recolours the paint, and recolouring the same rule in viewer.css does
     nothing at all. Same two colours as pdf-reader's .hl-sentence and .hl-word,
     so it looks identical — but painted by the browser onto the real glyph box,
     so none of that file's descender shadow-spread trick is needed. */
  ::highlight(epub-sentence) {
    background-color: rgba(255, 214, 102, 0.34);
  }
  ::highlight(epub-word) {
    background-color: rgba(255, 165, 38, 0.6);
  }
`;

export function create(container) {
  let epub = null;
  const slots = new Map();
  let visibility = null;
  let retention = null;

  function reset() {
    if (visibility) visibility.disconnect();
    if (retention) retention.disconnect();
    for (const slot of slots.values()) teardown(slot);
    container.textContent = "";
    slots.clear();

    visibility = new IntersectionObserver(onVisible, { rootMargin: RENDER_MARGIN });
    retention = new IntersectionObserver(onRetention, { rootMargin: KEEP_MARGIN });
  }

  function onVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const slot = slots.get(Number(entry.target.dataset.section));
      if (slot) fill(slot);
    }
  }

  // Section 8's "very large book" row: a chapter that has scrolled far away has
  // its DOM dropped and its blob URLs revoked. The slot keeps the height it had
  // so the scroll position does not jump when it goes.
  function onRetention(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      const slot = slots.get(Number(entry.target.dataset.section));
      if (slot && slot.filled) {
        slot.el.style.minHeight = `${slot.el.offsetHeight}px`;
        teardown(slot);
      }
    }
  }

  function teardown(slot) {
    for (const url of slot.blobUrls) URL.revokeObjectURL(url);
    slot.blobUrls = [];
    slot.blobs.clear();
    if (slot.root) slot.root.replaceChildren();
    slot.filled = false;
    slot.pending = null;
  }

  // A resource inside the archive becomes a blob: URL. Tracked per chapter so it
  // can be revoked when that chapter is torn down.
  async function blobUrlFor(slot, path) {
    if (slot.blobs.has(path)) return slot.blobs.get(path);

    const bytes = await epub.resource(path);
    // A book referencing a file it does not contain should lose that image, not
    // the chapter around it.
    if (!bytes) return null;

    const url = URL.createObjectURL(new Blob([bytes], { type: epub.contentType(path) }));
    slot.blobs.set(path, url);
    slot.blobUrls.push(url);
    return url;
  }

  // Skip anything already absolute: an external image stays external (and simply
  // will not load, since the page has no network permission for it), and a data:
  // URI is already self-contained.
  const isExternal = (href) => /^(https?:|data:|blob:|mailto:|#)/i.test(href);

  // Attributes are matched on localName and rewritten through the Attr node
  // itself. A cover page is typically an SVG <image xlink:href="cover.jpeg">, and
  // that attribute is namespaced: a "[xlink\\:href]" selector does not match it,
  // and setAttribute("xlink:href", …) would add a second, unnamespaced attribute
  // beside the original rather than replacing it. Setting attr.value keeps the
  // namespace it already has.
  const URL_ATTRS = new Set(["src", "href", "poster"]);

  async function rewriteUrls(slot, root, basePath) {
    const jobs = [];

    for (const el of root.querySelectorAll("*")) {
      // A link to another chapter is navigation, not a resource — handled by the
      // click listener below, so it is left alone here.
      const isAnchor = el.localName === "a";

      for (const attr of [...el.attributes]) {
        if (isAnchor && attr.localName === "href") continue;
        if (!URL_ATTRS.has(attr.localName)) continue;
        const value = attr.value;
        if (!value || isExternal(value)) continue;
        jobs.push(
          blobUrlFor(slot, epub.resolve(basePath, value)).then((url) => {
            if (url) attr.value = url;
          }),
        );
      }

      const srcset = el.getAttribute("srcset");
      if (srcset) {
        jobs.push(
          Promise.all(
            srcset.split(",").map(async (part) => {
              const [href, ...rest] = part.trim().split(/\s+/);
              if (!href || isExternal(href)) return part.trim();
              const url = await blobUrlFor(slot, epub.resolve(basePath, href));
              return url ? [url, ...rest].join(" ") : part.trim();
            }),
          ).then((parts) => el.setAttribute("srcset", parts.join(", "))),
        );
      }
    }

    await Promise.all(jobs);
  }

  // url(...) inside a stylesheet is resolved against the stylesheet's own
  // location, not the chapter's — a CSS file in styles/ referring to
  // ../fonts/x.otf is relative to styles/.
  async function rewriteCssUrls(slot, css, cssPath) {
    const refs = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)];
    const replacements = new Map();

    await Promise.all(
      refs.map(async ([, , href]) => {
        if (isExternal(href) || replacements.has(href)) return;
        const url = await blobUrlFor(slot, epub.resolve(cssPath, href));
        if (url) replacements.set(href, url);
      }),
    );

    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote, href) =>
      replacements.has(href) ? `url("${replacements.get(href)}")` : whole,
    );
  }

  async function collectStyles(slot, doc, basePath) {
    const sheets = [];

    for (const node of doc.querySelectorAll("style, link[rel~='stylesheet' i]")) {
      if (node.tagName.toLowerCase() === "style") {
        sheets.push(await rewriteCssUrls(slot, node.textContent, basePath));
        continue;
      }
      const href = node.getAttribute("href");
      if (!href || isExternal(href)) continue;

      const path = epub.resolve(basePath, href);
      const bytes = await epub.resource(path);
      if (!bytes) continue;
      sheets.push(await rewriteCssUrls(slot, new TextDecoder("utf-8").decode(bytes), path));
    }

    return sheets;
  }

  // Every caller of a chapter gets the same promise for it, and it resolves only
  // once that chapter is actually on screen. A plain "already started" guard is
  // not enough: the observer starts a chapter, then show() is called for the same
  // one and returns immediately, handing back a shadow root that is still empty.
  // core/text-walk then walks nothing and the chapter silently loses its text.
  function fill(slot) {
    if (!slot.pending) slot.pending = doFill(slot);
    return slot.pending;
  }

  async function doFill(slot) {
    const item = epub.spine[slot.section];
    if (!item.present) {
      // Section 8: a chapter missing from the archive costs its own slot and
      // nothing else.
      slot.el.classList.remove("loading");
      slot.el.classList.add("failed");
      slot.el.textContent = "";
      slot.filled = true;
      return;
    }

    try {
      const doc = await epub.section(slot.section);

      // Explicitly, before anything is attached: a shadow root runs script just
      // as the main document would. CSP is the second line of defence, not the
      // first (section 9).
      for (const script of doc.querySelectorAll("script")) script.remove();
      for (const el of doc.querySelectorAll("[onload], [onerror], [onclick]")) {
        for (const attr of [...el.attributes]) {
          if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
        }
      }

      const styles = await collectStyles(slot, doc, item.path);
      await rewriteUrls(slot, doc, item.path);

      const root = slot.root ?? slot.el.attachShadow({ mode: "open" });
      slot.root = root;

      const sheet = new CSSStyleSheet();
      sheet.replaceSync(BASE_STYLES);
      const bookSheets = styles.map((css) => {
        const s = new CSSStyleSheet();
        // A book's stylesheet can contain at-rules Chrome rejects wholesale.
        // Losing that book's styling is survivable; losing the chapter is not.
        try {
          s.replaceSync(css);
        } catch {
          /* ignore */
        }
        return s;
      });
      root.adoptedStyleSheets = [sheet, ...bookSheets];

      const body = doc.body ?? doc.documentElement;
      root.replaceChildren(...document.adoptNode(body).childNodes);

      slot.el.classList.remove("loading");
      slot.el.style.minHeight = "";
      slot.filled = true;

      // A chapter can be filled more than once, because it is torn down when it
      // scrolls far away. Anything holding references into its DOM — the text
      // model's words — has to hear about that. The renderer does not know who is
      // listening or what they do with it.
      api.onFill?.(slot.section, slot.root);
    } catch (err) {
      slot.el.classList.add("failed");
      slot.el.classList.remove("loading");
      slot.el.title = `chapter ${slot.section} failed: ${err.message}`;
      slot.filled = true;
      console.warn(`[epub-reader] chapter ${slot.section} failed:`, err);
    }
  }

  function buildSlots() {
    for (let n = 0; n < epub.sectionCount; n++) {
      const el = document.createElement("div");
      el.className = "chapter loading";
      el.dataset.section = n;
      container.append(el);

      slots.set(n, {
        section: n,
        el,
        root: null,
        blobs: new Map(),
        blobUrls: [],
        pending: null,
        filled: false,
      });
      visibility.observe(el);
      retention.observe(el);
    }
  }

  // A link inside a book is either a jump to another chapter, which is a scroll
  // in our page, or an outside link, which is a new tab. Neither is a navigation
  // of the viewer itself — that would throw the whole book away.
  container.addEventListener("click", async (e) => {
    const anchor = e.target.closest?.("a[href]") ?? e.composedPath().find((n) => n.tagName === "A");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href) return;

    if (/^https?:/i.test(href)) {
      e.preventDefault();
      window.open(href, "_blank", "noopener");
      return;
    }
    if (/^(mailto:|data:|blob:)/i.test(href)) return;

    e.preventDefault();
    const chapterEl = anchor.getRootNode()?.host ?? anchor.closest(".chapter");
    const from = chapterEl ? epub.spine[Number(chapterEl.dataset.section)].path : "";
    const target = epub.resolve(from, href);

    const index = epub.spine.findIndex((s) => s.path === target);
    if (index < 0) return;

    await api.show(index);
    slots.get(index)?.el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const api = {
    // Set by the viewer: called with (section, shadowRoot) every time a chapter
    // finishes rendering, including every re-render after a teardown.
    onFill: null,

    load(loaded) {
      epub = loaded;
      reset();
      buildSlots();
    },

    // Render a chapter now rather than waiting for it to be scrolled to. This is
    // what the model calls before walking a chapter's text, and what playback's
    // prefetch calls one chapter ahead (section 6).
    async show(n) {
      const slot = slots.get(n);
      if (!slot) return null;
      await fill(slot);
      return slot.root;
    },

    // The shadow root a chapter's text lives in, or null if it is not rendered.
    // core/text-walk walks this.
    root: (n) => (slots.get(n)?.filled ? slots.get(n).root : null),
    element: (n) => slots.get(n)?.el ?? null,
    get sectionCount() {
      return epub ? epub.sectionCount : 0;
    },
  };

  return api;
}
