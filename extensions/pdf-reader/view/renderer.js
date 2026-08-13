// view/renderer — draws pages and the selectable text layer.
// Knows nothing about speech or sentences.

// Pages render as they approach the viewport. A 700-page book must not try to
// rasterise itself on open (section 8, "very large PDF").
const RENDER_MARGIN = "600px";

export function create(container) {
  let parser = null;
  let scale = 1.3;
  const slots = new Map();
  let observer = null;

  function reset() {
    if (observer) observer.disconnect();
    container.textContent = "";
    slots.clear();
    observer = new IntersectionObserver(onVisible, { root: null, rootMargin: RENDER_MARGIN });
  }

  async function onVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const slot = slots.get(Number(entry.target.dataset.page));
      if (slot && !slot.started) {
        slot.started = true;
        observer.unobserve(entry.target);
        await drawPage(slot);
      }
    }
  }

  async function drawPage(slot) {
    try {
      const viewport = await parser.renderPage(slot.page, slot.canvas, scale);

      // pdf.js positions the text spans using this custom property.
      slot.text.style.setProperty("--scale-factor", scale);
      slot.text.style.width = `${Math.floor(viewport.width)}px`;
      slot.text.style.height = `${Math.floor(viewport.height)}px`;
      await parser.textLayer(slot.page, slot.text, viewport);

      slot.el.classList.remove("loading");
    } catch (err) {
      slot.el.classList.add("failed");
      slot.el.title = `page ${slot.page} failed: ${err.message}`;
    }
  }

  async function buildSlots() {
    for (let n = 1; n <= parser.pageCount; n++) {
      const viewport = await parser.viewport(n, scale);

      const el = document.createElement("div");
      el.className = "page loading";
      el.dataset.page = n;
      // Reserve the real height up front so the scrollbar is honest before
      // anything has rendered.
      el.style.width = `${Math.floor(viewport.width)}px`;
      el.style.height = `${Math.floor(viewport.height)}px`;

      const canvas = document.createElement("canvas");
      // Sits between the canvas and the (transparent) text layer, so a highlight
      // painted here shows through without covering the selectable spans.
      const highlight = document.createElement("div");
      highlight.className = "highlight-layer";
      const text = document.createElement("div");
      text.className = "text-layer";

      el.append(canvas, highlight, text);
      container.append(el);

      slots.set(n, { page: n, el, canvas, highlight, text, viewport, started: false });
      observer.observe(el);
    }
  }

  // Every slot gets its viewport in buildSlots, before anything has rasterised,
  // so the two calls below work on pages that are still blank.
  return {
    async load(loadedParser) {
      parser = loadedParser;
      reset();
      await buildSlots();
    },

    // The element a highlight for this page should be drawn into, and the page
    // element it is positioned against.
    overlay: (page) => slots.get(page)?.highlight ?? null,
    pageElement: (page) => slots.get(page)?.el ?? null,

    // PDF page coordinates (origin bottom-left, y up, unscaled) → pixels inside
    // the page element. Converting both corners rather than scaling by hand
    // keeps rotated pages correct, and keeps pdf.js viewport types in this file.
    toPixels(page, rect) {
      const slot = slots.get(page);
      if (!slot) return null;

      const [x1, y1] = slot.viewport.convertToViewportPoint(rect.x, rect.y + rect.height);
      const [x2, y2] = slot.viewport.convertToViewportPoint(rect.x + rect.width, rect.y);
      return {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    },

    get scale() {
      return scale;
    },

    async setScale(next) {
      scale = next;
      if (parser) {
        reset();
        await buildSlots();
      }
    },
  };
}
