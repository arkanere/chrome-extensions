// view/highlighter — paints the word being spoken and the sentence around it.
//
// It is handed a Sentence and a word index. It knows nothing about speech and
// nothing about the article: a Word already carries the text nodes and offsets
// it occupies, so the work is building two Ranges and handing them to the
// browser.
//
// The CSS Custom Highlight API paints a Range without touching the DOM, and
// survives reflow — so the article's own markup is never mutated, and the
// <mark> wrapping the Highlights feature does can coexist with it.
//
// Copied from epub-reader with one change: the reader scrolls .rm-scroll, not
// the window, so every window.scrollBy and window.innerHeight below is the
// scroller's instead. Because .rm-scroll is pinned at inset: 0, viewport and
// scroller coordinates coincide and getBoundingClientRect needs no translation.

// The sticky bar, plus a little air. A word tucked directly under it reads as
// off screen even though it technically is not. The siblings hard-code 92; the
// bar here is a measured height, because its font and padding can change.
const HEADER_AIR = 20;
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
  // Adding or removing an in-page highlight splits or merges the article's text
  // nodes, and the words then point at nodes that hang off nothing. Painting
  // into them is invisible; measuring them gives zeros and would scroll the page
  // to the top. content.js re-walks and rebinds, and refresh() draws again.
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

// `scrollEl` is .rm-scroll; `barEl` is the sticky bar the word must stay clear
// of. Both belong to one open overlay, so a reader closed and reopened gets a
// fresh highlighter rather than one holding a detached element.
export function create(scrollEl, barEl) {
  let shown = null; // { sentence, wordIndex } — kept so a rebind can redraw
  let settleUntil = 0;

  const word = supported ? new Highlight() : null;
  const sentence = supported ? new Highlight() : null;
  if (supported) {
    CSS.highlights.set("rm-word", word);
    CSS.highlights.set("rm-sentence", sentence);
  }

  function headerHeight() {
    return (barEl ? barEl.getBoundingClientRect().height : 0) + HEADER_AIR;
  }

  // Scroll only when the word has actually left the comfortable band. Following
  // it every word would scroll on every single event.
  function follow(range, behavior = "smooth") {
    if (performance.now() < settleUntil) return false;

    const rect = range.getBoundingClientRect();
    if (!rect.height && !rect.width) return false; // not laid out, or a collapsed range

    const header = headerHeight();
    const bottom = scrollEl.clientHeight - BOTTOM_MARGIN;
    if (rect.top >= header && rect.bottom <= bottom) return true;

    const target = header + (scrollEl.clientHeight - header) * SCROLL_TARGET;
    scrollEl.scrollBy({ top: rect.top - target, behavior });
    settleUntil = performance.now() + SCROLL_SETTLE_MS;
    return true;
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

    // Scroll the painted sentence into view on demand. The resume needs it:
    // nothing has been spoken yet, so the position carries no word, and draw()'s
    // follow() tracks the word rather than the sentence — an article reopened
    // near its end would otherwise be highlighted somewhere far below the top of
    // the page. Playback never calls this; following the voice is draw()'s job,
    // one word at a time. The jump is instant rather than smooth, because it is a
    // page landing on its position, not the page keeping up with a voice.
    reveal() {
      if (!shown) return false;
      const words = shown.sentence.words;
      if (!words.length) return false;

      const band = rangeFor(words[0], words[words.length - 1]);
      if (!band) return false;
      settleUntil = 0;
      return follow(band, "auto");
    },

    // Adding or removing an in-page highlight splits or merges the article's
    // text nodes, so the model is rebound to the new ones and the same position
    // is drawn again.
    refresh() {
      draw();
    },

    // CSS.highlights is a global registry that outlives the overlay. Closing the
    // reader has to take our two entries out of it, or the next open registers
    // over ranges pointing into a document that no longer exists.
    dispose() {
      shown = null;
      if (!supported) return;
      word.clear();
      sentence.clear();
      CSS.highlights.delete("rm-word");
      CSS.highlights.delete("rm-sentence");
    },

    supported,
  };
}
