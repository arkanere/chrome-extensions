// Wiring only. Builds the modules and connects them; logic belongs in the modules.

import * as source from "./core/source.js";
import * as epubReaderCore from "./core/epub.js";
import * as textWalk from "./core/text-walk.js";
import * as modelFactory from "./core/document-model.js";
import * as rendererFactory from "./view/renderer.js";
import * as highlighterFactory from "./view/highlighter.js";
import * as speechAdapter from "./speech/adapter.js";
import * as playerFactory from "./player/controller.js";
import * as controlsFactory from "./view/controls.js";
import * as settings from "./store/settings.js";

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

const prefs = await settings.loadPrefs();
const voices = await speech.listVoices();

// A saved voice wins if it is still installed. If it is not, section 7's chain
// picks instead — and section 8's row for that says to tell the user which voice
// ended up speaking, which voiceNotes() does.
const savedVoice = prefs.voice ? voices.find((v) => v.id === prefs.voice) : null;
let voice = savedVoice || speechAdapter.chooseVoice(voices);
let rate = prefs.rate ?? 1;

console.log(
  `[epub-reader] voice: ${voice ? voice.label : "platform default"}` +
  `${voice && !voice.supportsWordEvents ? " — no word events" : ""}, rate ${rate}`,
);

// Section 8's "voice missing at load" row, and section 7's note that audio
// without highlighting beats no audio.
function voiceNotes() {
  const notes = [];
  if (prefs.voice && !savedVoice) {
    notes.push(
      `Your saved voice <b>${prefs.voice}</b> is not installed on this machine, ` +
      `so <b>${voice ? voice.label : "the platform default"}</b> is being used.`,
    );
  }
  if (!voice) {
    notes.push("No voice reporting word timing was found, so nothing will be highlighted.");
  } else if (!voice.supportsWordEvents) {
    notes.push(`<b>${voice.label}</b> reports no word timing, so nothing will be highlighted.`);
  }
  return notes;
}

const controls = controlsFactory.create(
  document.getElementById("controls"),
  { voices, voice: voice && voice.id, rate, rateRange: speechAdapter.rateRange },
  {
    toggle() {
      if (!player) return;
      clearNotice();
      player.toggle();
    },
    next: () => player && player.next(),
    previous: () => player && player.previous(),

    voice(id) {
      voice = voices.find((v) => v.id === id) || null;
      if (player) player.setVoice(id);
      settings.savePrefs({ voice: id });
    },
    rate(value) {
      rate = value;
      if (player) player.setRate(value);
      settings.savePrefs({ rate: value });
    },
  },
);
controls.setEnabled(false);

// Follows pdf-reader's startPlayer almost line for line — the payoff for the
// pipeline having been one-directional. The highlighter and store/settings both
// hang off the same Position events, and neither knows about the other.
function startPlayer(startAt) {
  player = playerFactory.create(model, speech, {
    voice: voice && voice.id,
    rate,
    sentenceId: startAt,
  });

  player.onState(({ playing }) => controls.setPlaying(playing));
  player.onEnd(() => {
    // The book is finished, so there is nothing left to resume to. Leaving the
    // position behind would reopen it on its last sentence forever.
    notice("Reached the end of the book.");
    settings.clearPosition(doc.key);
  });
  player.onError((message) => notice(`Speech stopped: ${message}. Press play to resume.`, true));

  // The Position seam (section 5.3): the controller reports where it is, the
  // viewer looks the sentence up, and the highlighter draws it. Neither side
  // knows the other.
  let lastSaved = -1;
  player.onPosition((position) => {
    if (window.epubReader.trace) console.log("[epub-reader] position", position);
    const sentence = model.sentence(position.sentenceId);
    highlighter.show(sentence, position.wordIndex);

    // One write per sentence — a few seconds apart at any speed — rather than one
    // per word. What is written is the chapter and the character offset into it
    // (4.3), never the sentence id.
    if (sentence && position.sentenceId !== lastSaved) {
      lastSaved = position.sentenceId;
      settings.savePosition(doc.key, sentence.section, sentence.start, doc.label);
    }
  });

  controls.setEnabled(true);
  controls.setPlaying(player.playing);
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
  controls.setEnabled(false);

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
    // 4.3's resume: a saved { spineIndex, charOffset } is turned back into a
    // sentence by walking the model up to that chapter and looking the offset up
    // inside it. A chapter that is no longer there — a book replaced by a
    // different edition under the same name would do it — simply starts at the
    // beginning rather than failing to open.
    const remembered = await settings.loadPosition(doc.key);
    let startAt = 0;

    if (remembered && remembered.spineIndex < book.sectionCount) {
      await model.ensureSections(remembered.spineIndex + 1);
      const sentence = model.sentenceAtOffset(remembered.spineIndex, remembered.charOffset);
      if (sentence) startAt = sentence.id;
    }

    startPlayer(startAt);

    // Seeking rather than only starting there: it emits a Position, which paints
    // the highlight and scrolls the chapter into view, so the resume is visible
    // before anything is spoken.
    if (startAt > 0) {
      await player.seek(startAt);
      // The seek paints the sentence but does not move the page: no word has been
      // spoken yet, and scroll-follow tracks the word. Ask for it explicitly.
      highlighter.reveal();
      notes.push(
        `Picked up where you stopped, in chapter ${remembered.spineIndex + 1} of ${book.sectionCount}. ` +
        `<a href="#" data-action="restart">Start from the beginning</a>`,
      );
    }
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

// The only interactive thing a notice ever offers: throw the remembered position
// away and go back to the first sentence.
noticeEl.addEventListener("click", (e) => {
  const link = e.target.closest('[data-action="restart"]');
  if (!link) return;
  e.preventDefault();
  clearNotice();
  if (doc) settings.clearPosition(doc.key);
  if (player) player.seek(0);
});

// Click a word to read from there. In pdf-reader this was a hit test over the
// boxes every Word carried; here the browser does the hit test for us, because
// the words are real text nodes. caretPositionFromPoint gives a node and an
// offset, and a Word already records exactly that pair.
//
// The one EPUB-specific part is the shadow root: from the document's point of
// view a click inside a chapter lands on the chapter div, and the caret APIs stop
// at the shadow boundary unless they are handed the roots to look inside.
function caretAt(x, y, root) {
  const pos = document.caretPositionFromPoint?.(x, y, { shadowRoots: root ? [root] : [] });
  if (pos && pos.offsetNode?.nodeType === Node.TEXT_NODE) {
    return { node: pos.offsetNode, offset: pos.offset };
  }
  // Older Chrome, and the static server's engine: the non-standard call, which
  // does pierce shadow roots but reports a Range rather than a position.
  const range = document.caretRangeFromPoint?.(x, y);
  if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
    return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

// The last word in this text node that starts at or before the caret, which is
// the word the click is inside. Words are in reading order, so the scan can stop
// as soon as it is past the offset. The model is not asked to do this: it would
// mean comparing DOM nodes inside a file that must not know what a DOM is (4.2),
// and a chapter's word list is short enough to walk.
function wordAt(section, node, offset) {
  let hit = null;
  let firstInNode = null;

  for (const sentence of model.sentencesInSection(section)) {
    for (let i = 0; i < sentence.words.length; i++) {
      const word = sentence.words[i];
      if (word.node !== node) continue;
      if (!firstInNode) firstInNode = { sentenceId: sentence.id, wordIndex: i };
      if (word.nodeStart <= offset) hit = { sentenceId: sentence.id, wordIndex: i };
      else return hit ?? firstInNode;
    }
  }
  // Clicking past the last word of a node lands on that word; clicking before the
  // first one lands on it. Both read as "start here".
  return hit ?? firstInNode;
}

// A click has to share the page with text selection. A click that moved between
// press and release, or that ends with text selected, is the user selecting — not
// asking to be read to. Copied from pdf-reader, slop and all.
const DRAG_SLOP = 4;
let pressedAt = null;

chaptersEl.addEventListener("pointerdown", (e) => {
  pressedAt = { x: e.clientX, y: e.clientY };
});

chaptersEl.addEventListener("click", async (e) => {
  const down = pressedAt;
  pressedAt = null;

  if (!player || !model || !down) return;
  if (Math.abs(e.clientX - down.x) > DRAG_SLOP || Math.abs(e.clientY - down.y) > DRAG_SLOP) return;
  if (!(window.getSelection()?.isCollapsed ?? true)) return;
  // A link inside the book is the renderer's business, not ours.
  if (e.composedPath().some((n) => n.tagName === "A")) return;

  // Retargeted at the shadow boundary, so this is the chapter div however deep
  // inside the book's markup the click landed.
  const chapterEl = e.target.closest?.(".chapter");
  if (!chapterEl) return;
  const section = Number(chapterEl.dataset.section);

  const caret = caretAt(e.clientX, e.clientY, renderer.root(section));
  if (!caret) return;

  // A chapter is drawn as it is scrolled to and walked as playback reaches it, so
  // a click can easily be the first thing that needs this chapter's sentences.
  await model.ensureSections(section + 1);
  const hit = wordAt(section, caret.node, caret.offset);
  if (!hit) return;

  // Seeking is by sentence, not by word: the adapter speaks a whole Sentence.text
  // and starting mid-string would break the controller's charIndex mapping.
  // Sentences are short (phase 4: a 15-word median), so the clicked word is only
  // ever a moment away.
  clearNotice();
  await player.seek(hit.sentenceId);
  if (!player.playing) await player.play();
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

  // Playback is the header's controls now; these stay because driving it from the
  // console is how everything before phase 7 was checked, and epubReader.player
  // exposes the rest.
  play: () => player && player.play(),
  pause: () => player && player.pause(),
  toggle: () => player && player.toggle(),
  seek: (id) => player && player.seek(id),

  voices: () => speech.listVoices(),

  // epubReader.forget() — drop this book's remembered position, so the next open
  // starts at the beginning. Used to re-test the resume by hand.
  forget: () => doc && settings.clearPosition(doc.key),

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
