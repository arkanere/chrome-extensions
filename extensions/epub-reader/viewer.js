// Wiring only. Builds the modules and connects them; logic belongs in the modules.

import * as source from "./core/source.js";
import * as epubReaderCore from "./core/epub.js";
import * as textWalk from "./core/text-walk.js";
import * as modelFactory from "./core/document-model.js";
import * as rendererFactory from "./view/renderer.js";
import * as highlighterFactory from "./view/highlighter.js";
import * as speechAdapter from "./speech/adapter.js";
import * as playerFactory from "./player/controller.js";

const titleEl = document.getElementById("title");
const noticeEl = document.getElementById("notice");
const chaptersEl = document.getElementById("chapters");
const renderer = rendererFactory.create(chaptersEl);
const highlighter = highlighterFactory.create();

// The static server in section 11's ground rules runs these same modules on a
// plain page, where `chrome` does not exist at all — and the adapter's default
// argument would throw a ReferenceError before anything loaded. Speech is the one
// thing that genuinely cannot work there; the rest of the viewer must still come
// up, because that server is how the corpus is swept. The stub reports no voices,
// and never calls speak's callback, which is where the adapter would reach for
// chrome.runtime.
const NO_TTS = {
  getVoices: (cb) => cb([]),
  speak: () => {},
  stop: () => {},
};
const speech = speechAdapter.create(globalThis.chrome?.tts ?? NO_TTS);

// A chapter that scrolls far away is torn down, and comes back built from new
// text nodes. The words the model holds for it would then point into a document
// fragment nothing can see, so they are rebound to the rebuilt chapter here.
// Neither module knows about the other: the renderer reports that a chapter was
// filled, and the model is handed runs, exactly as on the first pass.
renderer.onFill = (n, root) => {
  if (!model) return;
  const rebound = model.rebindSection(n, textWalk.walk(root));
  // The painted ranges pointed into the DOM that was just thrown away. Now the
  // words hold live nodes again, the same position can be drawn.
  if (rebound && highlighter.section === n) highlighter.refresh();
};

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
let model = null;
let player = null;

// Phase 7 replaces both of these with store/settings.js and the voice picker.
// Until then section 7's chain picks, once, at load.
const voices = await speech.listVoices();
const voice = speechAdapter.chooseVoice(voices);
const rate = 1;

console.log(
  `[epub-reader] voice: ${voice ? voice.label : "platform default"}` +
  `${voice && !voice.supportsWordEvents ? " — no word events" : ""}, rate ${rate}`,
);

// Section 8's "voice missing at load" row, and section 7's note that audio
// without highlighting beats no audio.
function voiceNotes() {
  if (!voice) return ["No voice reporting word timing was found, so nothing will be highlighted."];
  if (!voice.supportsWordEvents) {
    return [`<b>${voice.label}</b> reports no word timing, so nothing will be highlighted.`];
  }
  return [];
}

// Follows pdf-reader's startPlayer almost line for line — the payoff for the
// pipeline having been one-directional. The highlighter subscribes to the same
// Position events in phase 6, and store/settings to them in phase 7.
function startPlayer(startAt) {
  player = playerFactory.create(model, speech, {
    voice: voice && voice.id,
    rate,
    sentenceId: startAt,
  });

  player.onEnd(() => notice("Reached the end of the book."));
  player.onError((message) => notice(`Speech stopped: ${message}. Press play to resume.`, true));

  // The Position seam (section 5.3): the controller reports where it is, the
  // viewer looks the sentence up, and the highlighter draws it. Neither side
  // knows the other.
  player.onPosition((position) => {
    if (window.epubReader.trace) console.log("[epub-reader] position", position);
    highlighter.show(model.sentence(position.sentenceId), position.wordIndex);
  });
}

// The model's text source (section 3's one new arrow): the renderer puts a
// chapter on screen, core/text-walk turns what it rendered into runs, and the
// model never learns that a DOM was involved. A chapter that failed to render has
// no shadow root and contributes no text rather than failing the book.
function textSource(loaded) {
  return {
    sectionCount: loaded.sectionCount,
    async runs(n) {
      return textWalk.walk(await renderer.show(n));
    },
  };
}

async function show(loaded) {
  doc = loaded;
  book = null;
  model = null;
  titleEl.textContent = doc.label;
  clearNotice();

  // Opening a second book while the first is speaking: the engine is stopped
  // before the model it was reading from is thrown away.
  if (player) player.pause();
  player = null;
  highlighter.clear();

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

  renderer.load(book);
  model = modelFactory.create(textSource(book));

  const notes = [];
  const missing = book.spine.filter((s) => !s.present);
  if (missing.length) {
    notes.push(
      `${missing.length} of this book's ${book.sectionCount} chapters ` +
      `${missing.length === 1 ? "is" : "are"} missing from the file and will be skipped.`,
    );
  }

  console.log(
    `[epub-reader] ${label} (${doc.label}, ${doc.bytes.byteLength} bytes): ` +
    `${book.sectionCount} sections, key ${doc.key.slice(0, 12)}…. ` +
    `Run epubReader.spine() to list them.`,
  );

  // Section 8's "book with no readable text" row. The probe renders the first few
  // chapters, which is work the reader would do a moment later anyway.
  if (await model.hasText()) {
    startPlayer(0);
    notes.push(...voiceNotes());
  } else {
    notice("This book contains no readable text, so it cannot be read aloud.", true);
    return;
  }

  if (notes.length) notice(notes.join("<br><br>"));
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

// chrome.tts speaks at the extension level, not the page's, so closing the tab
// mid-sentence would leave the voice talking to an empty room.
window.addEventListener("pagehide", () => speech.stop());

// Font size in place of pdf-reader's zoom (section 9): same two buttons and the
// same readout, but stepping a custom property the chapters inherit. Text
// reflows, so there is nothing to re-render and — from phase 6 — no highlight to
// refresh either.
const FONT_STEPS = [15, 17, 19, 21, 24, 27, 30];
let fontIndex = 2;

function applyFontSize() {
  const px = FONT_STEPS[fontIndex];
  document.documentElement.style.setProperty("--reading-font-size", `${px}px`);
  document.getElementById("font-size").textContent = `${Math.round((px / FONT_STEPS[2]) * 100)}%`;
}

document.getElementById("font-larger").addEventListener("click", () => {
  fontIndex = Math.min(fontIndex + 1, FONT_STEPS.length - 1);
  applyFontSize();
});

document.getElementById("font-smaller").addEventListener("click", () => {
  fontIndex = Math.max(fontIndex - 1, 0);
  applyFontSize();
});

applyFontSize();

// Debug mode: inspect the book from the devtools console. Not a URL flag, because
// the interceptor appends the source URL raw and anything after it would be read
// as part of that URL. It grows one entry per phase (section 0).
window.epubReader = {
  get book() {
    return book;
  },
  get renderer() {
    return renderer;
  },
  get model() {
    return model;
  },
  get player() {
    return player;
  },

  // epubReader.trace = true logs every Position the controller emits — the phase 5
  // check that Natural's two boundary events per word collapse into one.
  trace: false,

  // Until phase 7's controls exist, playback is driven from here.
  play: () => player && player.play(),
  pause: () => player && player.pause(),
  toggle: () => player && player.toggle(),
  seek: (id) => player && player.seek(id),

  // epubReader.render(n) — force a chapter to render without scrolling to it.
  render: (n) => renderer.show(n),

  // epubReader.highlight(id, word) — paint a sentence without playing it, to
  // check phase 6's ranges against the page on their own.
  async highlight(sentenceId, wordIndex = 0) {
    if (!model) return console.warn("[epub-reader] no book loaded");
    while (sentenceId >= model.sentences.length && model.parsedSections < model.sectionCount) {
      await model.ensureSections(model.parsedSections + 1);
    }
    const sentence = model.sentence(sentenceId);
    if (sentence) highlighter.show(sentence, wordIndex);
    return sentence;
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

  // epubReader.sentences(n) — the sentences of chapter n, as phase 4's exit
  // criteria ask for them. Renders and walks the chapter first if it has not
  // been read yet.
  async sentences(n = 0) {
    if (!model) return console.warn("[epub-reader] no book loaded");
    await model.ensureSections(n + 1);

    const found = model.sentencesInSection(n);
    console.table(
      found.map((s) => ({
        id: s.id,
        start: s.start,
        words: s.words.length,
        text: s.text.length > 80 ? `${s.text.slice(0, 77)}…` : s.text,
      })),
    );

    const lengths = found.map((s) => s.words.length).sort((a, b) => a - b);
    if (lengths.length) {
      console.log(
        `[epub-reader] chapter ${n}: ${found.length} sentences, ` +
        `median ${lengths[Math.floor(lengths.length / 2)]} words, ` +
        `longest ${lengths[lengths.length - 1]}`,
      );
    }
    return found;
  },
};

const src = sourceUrl();
if (src) {
  console.log(`[epub-reader] opened with src=${src}`);
  loadUrl(src);
} else {
  notice("Choose <b>Open a book</b> above, or drop an EPUB anywhere on this page.");
}
