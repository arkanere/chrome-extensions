// core/text-walk — one rendered chapter's DOM becomes an ordered array of text
// runs. It exists so that core/document-model can stay free of the DOM (4.2):
// everything that needs a DOM API happens here, and the model is handed plain
// objects whose `node` field it never looks inside.
//
// A run is `{ text, node }`, where `text` is the text node's raw text and `node`
// is the node itself. Offsets into `text` are therefore also offsets into the
// node, which is what lets the model hand back `{ node, nodeStart, nodeEnd }`
// without ever having measured anything.
//
// Two kinds of run carry no node:
//   - a break run (`break: true`), emitted between block-level elements. The
//     model starts a new sentence at one, so a heading never runs into the
//     paragraph under it.
//   - a separator run, emitted for <br>. It ends a word without ending a
//     sentence — without it, "line one<br>line two" would produce "onetwo".

// Elements whose text is not the book's prose.
const SKIP = new Set(["script", "style", "noscript", "template", "head", "title"]);

// Whether an element keeps its children on the same line. Everything that is not
// inline starts a new block, and so a new sentence. `contents` boxes disappear
// entirely, so they inherit their parent's behaviour — treating them as inline
// leaves the parent's break in place, which is right.
function isInline(display) {
  return display.startsWith("inline") || display === "contents" || display === "ruby";
}

// Walk a rendered chapter and return its runs, in document order.
//
// `root` is the chapter's shadow root. It must already be filled: an empty root
// yields an empty array rather than an error, because a chapter missing from the
// archive is a normal thing to walk over (section 8).
export function walk(root) {
  if (!root) return [];

  const runs = [];
  const view = root.ownerDocument?.defaultView ?? window;
  const blocks = new Map(); // element -> its nearest block ancestor
  let previousBlock = null;
  let first = true;

  const walker = view.document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      if (SKIP.has(node.localName)) return NodeFilter.FILTER_REJECT;
      // Hidden subtrees are not read aloud. Rejecting rather than skipping drops
      // their children too, which is the point — a display:none footnote block
      // should not be spoken from the middle of a paragraph.
      if (view.getComputedStyle(node).display === "none") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // The nearest ancestor of a text node that is not inline. Two text nodes with
  // different block ancestors are in different paragraphs; two with the same one
  // are in the same paragraph, however many <em>s sit between them.
  function blockOf(el) {
    if (!el || el === root) return root;
    if (blocks.has(el)) return blocks.get(el);

    const display = view.getComputedStyle(el).display;
    const block = isInline(display) ? blockOf(el.parentElement ?? el.getRootNode()?.host ?? root) : el;
    blocks.set(el, block);
    return block;
  }

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.localName === "br") runs.push({ text: " ", node: null });
      continue;
    }

    if (!node.data) continue;

    const block = blockOf(node.parentElement);
    if (!first && block !== previousBlock) runs.push({ text: "\n", node: null, break: true });
    previousBlock = block;
    first = false;

    runs.push({ text: node.data, node });
  }

  return runs;
}
