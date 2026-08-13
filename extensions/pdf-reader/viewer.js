// Wiring only. Builds the modules and connects them; logic belongs in the modules.

import * as source from "./core/source.js";
import * as parser from "./core/parser.js";
import * as documentModel from "./core/document-model.js";
import * as rendererFactory from "./view/renderer.js";

const titleEl = document.getElementById("title");
const noticeEl = document.getElementById("notice");
const renderer = rendererFactory.create(document.getElementById("pages"));

const ZOOM_STEPS = [0.75, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5];
let zoomIndex = 3;

function notice(html, isError) {
  noticeEl.hidden = false;
  noticeEl.className = isError ? "error" : "";
  noticeEl.innerHTML = html;
}

function clearNotice() {
  noticeEl.hidden = true;
}

// The interceptor appends the original URL raw, so take everything after "?src="
// literally rather than through URLSearchParams — a query string inside the PDF
// URL would otherwise be split at its first "&".
function sourceUrl() {
  const marker = "?src=";
  const at = location.href.indexOf(marker);
  return at === -1 ? null : location.href.slice(at + marker.length);
}

let model = null;

async function show(doc) {
  titleEl.textContent = doc.label;
  document.title = `${doc.label} — PDF Reader`;
  clearNotice();

  const parsed = await parser.open(doc.bytes);
  await renderer.load(parsed);

  model = documentModel.create(parsed);

  // Section 8's scanned-PDF row: no words in the opening pages means no text
  // layer, so phase 4 must not offer playback here.
  if (!(await model.hasText())) {
    notice("This PDF has no text layer. It is probably a scan, so reading it aloud will not be possible.");
  }

  console.log(
    `[pdf-reader] ${doc.label}: ${parsed.pageCount} pages, key ${doc.key.slice(0, 12)}…, ` +
    `${model.sentences.length} sentences in the first ${model.parsedPages}. ` +
    `Run pdfReader.sentences() to list them.`,
  );
}

async function loadUrl(url) {
  try {
    await show(await source.fromUrl(url));
  } catch (err) {
    if (url.startsWith("file://")) {
      notice(
        `Could not read <code>${url}</code>.<br><br>Local files need the extension's ` +
        `<b>Allow access to file URLs</b> switch, on its card at <code>chrome://extensions</code>. ` +
        `Chrome cannot grant that automatically. Failing that, use <b>Open a PDF</b> above.`,
        true,
      );
    } else {
      notice(`Could not load this PDF: ${err.message}`, true);
    }
    console.error("[pdf-reader]", err);
  }
}

document.getElementById("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) await show(await source.fromFile(file));
});

function applyZoom() {
  document.getElementById("zoom-level").textContent = `${Math.round(ZOOM_STEPS[zoomIndex] * 100)}%`;
  renderer.setScale(ZOOM_STEPS[zoomIndex]);
}

document.getElementById("zoom-in").addEventListener("click", () => {
  zoomIndex = Math.min(zoomIndex + 1, ZOOM_STEPS.length - 1);
  applyZoom();
});

document.getElementById("zoom-out").addEventListener("click", () => {
  zoomIndex = Math.max(zoomIndex - 1, 0);
  applyZoom();
});

// Debug mode (phase 3): inspect the text model from the devtools console. Not a
// URL flag, because the interceptor appends the source URL raw and anything
// after it would be read as part of that URL.
window.pdfReader = {
  get model() {
    return model;
  },

  // pdfReader.sentences()      — every page parsed so far
  // pdfReader.sentences(12)    — page 12, parsing up to it first
  // pdfReader.sentences(12, 20)
  async sentences(from, to = from) {
    if (!model) return console.warn("[pdf-reader] no document loaded");
    await (from === undefined ? model.ensureAll() : model.ensurePages(to));

    const shown = model.sentences.filter((s) => from === undefined || (s.page >= from && s.page <= to));
    console.table(
      shown.map((s) => ({ id: s.id, page: s.page, words: s.words.length, text: s.text })),
    );
    return shown;
  },
};

const src = sourceUrl();
if (src) {
  loadUrl(src);
} else {
  notice("Choose <b>Open a PDF</b> above, or open a PDF link — it will land here automatically.");
}
