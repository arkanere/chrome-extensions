// view/highlighter — paints the word being spoken and the sentence around it.
//
// It is handed a Sentence and a word index. It knows nothing about speech and
// nothing about EPUBs: a Word already carries the text nodes and offsets it
// occupies, so the work is building two Ranges and handing them to the browser.
//
// This is the file 2.2 promised would mostly disappear. pdf-reader painted
// absolutely-positioned divs from interpolated glyph boxes, and had to redraw
// them on every zoom. Here the CSS Custom Highlight API paints a Range without
// touching the DOM, and survives reflow — so changing the font size needs no
// redraw at all, and the book's own markup is never mutated (section 9).

// The sticky header, plus a little air. A word tucked directly under it reads as
// off screen even though it technically is not. Unchanged from pdf-reader,
// constants and all — only the measurement source changed.
const HEADER = 92;
const BOTTOM_MARGIN = 60;

// Where a word lands after a scroll: a third down the visible area, so the rest
// of the sentence and the next few lines stay in view.
const SCROLL_TARGET = 0.35;

// A smooth scroll takes a moment to finish. Re-measuring during it would see the
// old position and issue a second scroll, which is what makes tracking jumpy.
const SCROLL_SETTLE_MS = 450;

const supported = typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight === "function";

// A word can start in one text node and end in another — `dis<em>connect</em>ed`
// is one Word with four values (4.1). For the overwhelming majority endNode is
// node, so this is one Range either way.
function rangeFor(from, to) {
  if (!from || !to || !from.node || !to.endNode) return null;
  // A chapter that scrolled far away was torn down, and its nodes now hang off
  // nothing. Painting into them is invisible; measuring them gives zeros and
  // would scroll the page to the top. The re-render rebinds the words a moment
  // later and refresh() draws again.
  if (!from.node.isConnected || !to.endNode.isConnected) return null;

  try {
    const range = new Range();
    range.setStart(from.node, from.nodeStart);
    range.setEnd(to.endNode, to.nodeEnd);
    return range;
  } catch {
    // Offsets past the end of a node mean the chapter is not the one the model
    // read. Drawing nothing is better than throwing inside a position event.
    return null;
  }
}

export function create() {
  let shown = null; // { sentence, wordIndex } — kept so a rebind can redraw
  let settleUntil = 0;

  const word = supported ? new Highlight() : null;
  const sentence = supported ? new Highlight() : null;
  if (supported) {
    CSS.highlights.set("epub-word", word);
    CSS.highlights.set("epub-sentence", sentence);
  }

  // Scroll only when the word has actually left the comfortable band. Following
  // it every word would scroll on every single event.
  function follow(range) {
    if (performance.now() < settleUntil) return;

    const rect = range.getBoundingClientRect();
    if (!rect.height && !rect.width) return; // not laid out, or a collapsed range

    if (rect.top >= HEADER && rect.bottom <= window.innerHeight - BOTTOM_MARGIN) return;

    const target = HEADER + (window.innerHeight - HEADER) * SCROLL_TARGET;
    window.scrollBy({ top: rect.top - target, behavior: "smooth" });
    settleUntil = performance.now() + SCROLL_SETTLE_MS;
  }

  function draw() {
    if (!supported) return;
    word.clear();
    sentence.clear();
    if (!shown) return;

    const words = shown.sentence.words;
    if (!words.length) return;

    const band = rangeFor(words[0], words[words.length - 1]);
    if (band) sentence.add(band);

    // wordIndex is -1 between the utterance starting and its first boundary
    // event: the sentence is lit, no word is yet.
    const current = shown.wordIndex >= 0 ? words[shown.wordIndex] : null;
    if (!current) return;

    const range = rangeFor(current, current);
    if (!range) return;
    word.add(range);
    follow(range);
  }

  return {
    show(s, wordIndex) {
      if (!s) return;
      shown = { sentence: s, wordIndex };
      draw();
    },

    clear() {
      shown = null;
      draw();
    },

    // A chapter torn down and rebuilt gives the model new nodes (2.5). The
    // ranges built from the old ones point at nothing, so the caller asks for
    // the same position again once the words have been rebound.
    refresh() {
      draw();
    },

    // Which section the painted sentence belongs to, so the caller can tell
    // whether a re-rendered chapter is the one on screen.
    get section() {
      return shown ? shown.sentence.section : -1;
    },

    supported,
  };
}
