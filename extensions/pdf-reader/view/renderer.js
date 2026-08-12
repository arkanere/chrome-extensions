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
      const text = document.createElement("div");
      text.className = "text-layer";

      el.append(canvas, text);
      container.append(el);

      slots.set(n, { page: n, el, canvas, text, started: false });
      observer.observe(el);
    }
  }

  return {
    async load(loadedParser) {
      parser = loadedParser;
      reset();
      await buildSlots();
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
