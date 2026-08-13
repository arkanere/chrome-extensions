// view/highlighter — paints the word being spoken and the sentence around it.
//
// It is handed a Sentence and a word index. It knows nothing about speech, and
// nothing about pdf.js: geometry arrives as Word.rects in PDF page coordinates
// and view/renderer turns those into pixels for the current zoom.
//
// Why an overlay rather than the pdf.js text layer (section 9's first choice):
// a Word carries no link back to the span it came from. tokensFromItem drops the
// item index and hyphen-rejoining merges tokens across items, so using spans
// would mean adding provenance to core/document-model. Word.rects already exists
// for exactly this, so the overlay costs nothing extra. Recorded in phase 5.

// Word boxes whose tops are within this fraction of a line height belong to the
// same line, and merge into one band for the sentence highlight.
const SAME_LINE = 0.6;

// The sticky header, plus a little air. A word tucked directly under it reads as
// off screen even though it technically is not.
const HEADER = 92;
const BOTTOM_MARGIN = 60;

// Where a word lands after a scroll: a third down the visible area, so the rest
// of the sentence and the next few lines stay in view.
const SCROLL_TARGET = 0.35;

// A smooth scroll takes a moment to finish. Re-measuring during it would see the
// old position and issue a second scroll, which is what makes tracking jumpy.
const SCROLL_SETTLE_MS = 450;

function box(left, top, width, height) {
  const el = document.createElement("div");
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  return el;
}

// One band per line, spanning from the first word on it to the last. Drawing
// each word separately would leave a gap at every space.
//
// Only the most recent band is considered, never every band seen so far. Words
// arrive in reading order, so that is enough to join a line — and on a
// two-column page it is what stops the left and right columns, which sit at the
// same height, from merging into one band across the gutter.
function bands(boxes) {
  const lines = [];

  for (const b of boxes) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.top - b.top) <= line.height * SAME_LINE) {
      line.left = Math.min(line.left, b.left);
      line.right = Math.max(line.right, b.left + b.width);
      line.top = Math.min(line.top, b.top);
      line.height = Math.max(line.height, b.height);
    } else {
      lines.push({ left: b.left, right: b.left + b.width, top: b.top, height: b.height });
    }
  }
  return lines;
}

export function create(renderer) {
  let shown = null; // { sentence, wordIndex } — kept so a zoom change can redraw
  let layer = null;
  let settleUntil = 0;

  function pixelsFor(page, rects) {
    return rects.map((r) => renderer.toPixels(page, r)).filter(Boolean);
  }

  // Scroll only when the word has actually left the comfortable band. Following
  // it every word would scroll on every single event.
  function follow(page, boxes) {
    if (!boxes.length) return;
    const pageEl = renderer.pageElement(page);
    if (!pageEl || performance.now() < settleUntil) return;

    const pageTop = pageEl.getBoundingClientRect().top;
    const top = pageTop + Math.min(...boxes.map((b) => b.top));
    const bottom = pageTop + Math.max(...boxes.map((b) => b.top + b.height));
    if (top >= HEADER && bottom <= window.innerHeight - BOTTOM_MARGIN) return;

    const target = HEADER + (window.innerHeight - HEADER) * SCROLL_TARGET;
    window.scrollBy({ top: top - target, behavior: "smooth" });
    settleUntil = performance.now() + SCROLL_SETTLE_MS;
  }

  function draw() {
    // Clears the previous page's overlay too, when a sentence moves us on.
    if (layer) layer.textContent = "";
    if (!shown) return;

    const { sentence, wordIndex } = shown;
    layer = renderer.overlay(sentence.page);
    if (!layer) return; // the page is not laid out yet

    const sentenceBoxes = pixelsFor(sentence.page, sentence.words.flatMap((w) => w.rects));
    for (const line of bands(sentenceBoxes)) {
      const el = box(line.left, line.top, line.right - line.left, line.height);
      el.className = "hl-sentence";
      layer.append(el);
    }

    // wordIndex is -1 between the utterance starting and its first boundary
    // event: the sentence is lit, no word is yet.
    const word = wordIndex >= 0 ? sentence.words[wordIndex] : null;
    if (!word) return;

    const wordBoxes = pixelsFor(sentence.page, word.rects);
    for (const b of wordBoxes) {
      const el = box(b.left, b.top, b.width, b.height);
      el.className = "hl-word";
      layer.append(el);
    }
    follow(sentence.page, wordBoxes);
  }

  return {
    show(sentence, wordIndex) {
      if (!sentence) return;
      shown = { sentence, wordIndex };
      draw();
    },

    clear() {
      shown = null;
      if (layer) layer.textContent = "";
      layer = null;
    },

    // A zoom change rebuilds every page, taking the overlays with it. The caller
    // asks for the same position back at the new scale.
    refresh() {
      layer = null;
      draw();
    },
  };
}
