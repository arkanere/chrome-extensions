// core/parser — the only file in the project that imports pdf.js.
// Exposes page count, page rendering and raw text items. Knows nothing about
// sentences, speech or the DOM beyond the canvas it is handed.

import * as pdfjs from "../lib/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.mjs");

export async function open(bytes) {
  const doc = await pdfjs.getDocument({
    // pdf.js takes ownership of the buffer, so hand it a copy — core/source's
    // caller may still want the original (it already hashed it, but cheap insurance).
    data: new Uint8Array(bytes.slice(0)),
    standardFontDataUrl: chrome.runtime.getURL("lib/standard_fonts/"),
  }).promise;

  const pages = new Map();
  const getPage = async (n) => {
    if (!pages.has(n)) pages.set(n, await doc.getPage(n));
    return pages.get(n);
  };

  return {
    pageCount: doc.numPages,

    async viewport(n, scale) {
      const page = await getPage(n);
      return page.getViewport({ scale });
    },

    async renderPage(n, canvas, scale) {
      const page = await getPage(n);
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      await page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
      }).promise;

      return viewport;
    },

    // Raw pdf.js text items. Turning these into sentences is phase 3's job,
    // in core/document-model, which must not import this file's types.
    async textItems(n) {
      const page = await getPage(n);
      const content = await page.getTextContent();
      return content.items;
    },

    async textLayer(n, container, viewport) {
      const page = await getPage(n);
      const layer = new pdfjs.TextLayer({
        textContentSource: await page.getTextContent(),
        container,
        viewport,
      });
      await layer.render();
    },

    destroy() {
      pages.clear();
      doc.destroy();
    },
  };
}

export const version = pdfjs.version;
