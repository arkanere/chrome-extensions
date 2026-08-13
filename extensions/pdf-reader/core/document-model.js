// core/document-model — raw text items become words and sentences with page
// geometry. This is the pivot of the design: parsing produces it, playback
// consumes it, highlighting renders it.
//
// It imports nothing. It is handed the item array that core/parser returns and
// reads only `str`, `transform`, `width`, `height` and `hasEOL` off it, so it
// stays free of pdf.js types and of the DOM. That also makes it runnable in
// plain node, which is how its sentence splitting was checked against real
// documents.
//
// Geometry is kept in PDF page coordinates: origin bottom-left, y pointing up,
// unscaled. The highlighter converts to screen pixels using the current zoom.

// A new item whose baseline sits this far from the current line's baseline,
// measured in line heights, starts a new line. hasEOL usually tells us first;
// this is the fallback for producers that do not set it.
const LINE_BREAK_RATIO = 0.5;

// A period after one of these is an abbreviation, not a sentence end. Kept
// deliberately short — section 10's stance is to fix only what really breaks.
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie",
  "al", "fig", "figs", "eq", "eqs", "ref", "refs", "no", "vol", "pp", "ed",
  "eds", "cf", "approx", "dept", "univ", "inc", "ltd", "co", "jan", "feb",
  "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

// End punctuation, optionally closed by a quote or bracket, then whitespace,
// then something that can open a sentence.
const SENTENCE_END = /([.?!])(["'”’)\]]*)(\s+)(?=["'“‘(\[]*[A-Z0-9])/g;

// Tables of contents, code listings and tables carry no sentence punctuation, so
// they come out as one run of a hundred words or more. Measured at up to 223 on
// a real paper. Section 2.5 puts synthesis latency at ~1.3 s for 573 characters
// and it grows with input, so a run that long would stall playback with no place
// to pause. Anything over the cap is cut at the last clause break before it.
const MAX_SENTENCE_WORDS = 45;
const CLAUSE_BREAK = /[,;:)—]$/;

function geometry(item) {
  const [, b, , d, e, f] = item.transform;
  return {
    x: e,
    y: f,
    width: item.width,
    // height is 0 on some producers; fall back to the transform's vertical scale.
    height: item.height || Math.hypot(b, d) || 0,
  };
}

// Split one item into whitespace-free tokens, giving each a rect. Character
// positions inside an item are interpolated on character count — pdf.js does
// not report per-glyph advances, so a word's box is a few points off in
// proportional fonts. Good enough to highlight; revisit only if it looks wrong.
function tokensFromItem(item) {
  const text = item.str;
  if (!text || !text.trim()) return [];

  const g = geometry(item);
  const perChar = g.width / text.length;
  const tokens = [];

  for (const match of text.matchAll(/\S+/g)) {
    tokens.push({
      text: match[0],
      rect: {
        x: g.x + match.index * perChar,
        y: g.y,
        width: match[0].length * perChar,
        height: g.height,
      },
    });
  }
  return tokens;
}

function linesFromItems(items) {
  const lines = [];
  let current = null;
  let previousEndedLine = true;

  for (const item of items) {
    const tokens = tokensFromItem(item);
    if (tokens.length) {
      const g = geometry(item);
      const jumped =
        current && Math.abs(g.y - current.y) > Math.max(g.height, 1) * LINE_BREAK_RATIO;

      if (!current || previousEndedLine || jumped) {
        current = { y: g.y, tokens: [] };
        lines.push(current);
      }
      current.tokens.push(...tokens);
      current.y = g.y;
    }
    previousEndedLine = item.hasEOL === true;
  }
  return lines;
}

// Lines become one flat word list. A word broken by a hyphen at a line end is
// rejoined and keeps both halves' rects — this is the wrapped-word case that
// Word.rects exists for. Genuine hyphenated compounds that happen to fall on a
// line break lose their hyphen; that is a known and accepted limit.
function wordsFromLines(lines) {
  const words = [];
  let hyphenated = null;

  for (const line of lines) {
    for (const token of line.tokens) {
      if (hyphenated) {
        hyphenated.text += token.text;
        hyphenated.rects.push(token.rect);
        hyphenated = null;
        continue;
      }
      words.push({ text: token.text, rects: [token.rect] });
    }

    const last = words[words.length - 1];
    if (last && /\p{L}-$/u.test(last.text)) {
      last.text = last.text.slice(0, -1);
      hyphenated = last;
    }
  }

  // A hyphen at the very end of a page continues on the next one, which we do
  // not have here. Put it back rather than swallow it.
  if (hyphenated) hyphenated.text += "-";
  return words;
}

// Words joined by single spaces, each one carrying its offset into the result.
function layout(words) {
  let text = "";
  const placed = [];

  for (const word of words) {
    if (text) text += " ";
    const start = text.length;
    text += word.text;
    placed.push({ text: word.text, start, end: text.length, rects: word.rects });
  }
  return { text, words: placed };
}

function isAbbreviation(text, periodAt) {
  const before = text.slice(0, periodAt);
  const token = (before.match(/\S+$/) || [""])[0];
  if (/^\p{Lu}$/u.test(token)) return true; // a single initial, as in "J. Smith"
  return ABBREVIATIONS.has(token.toLowerCase().replace(/[^\p{L}]/gu, ""));
}

// Character ranges over the page text, one per sentence. Ranges never include
// the whitespace between sentences, so every range starts exactly on a word.
function sentenceRanges(text) {
  const ranges = [];
  let start = 0;

  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(text); m; m = SENTENCE_END.exec(text)) {
    const punctuationAt = m.index;
    if (m[1] === "." && isAbbreviation(text, punctuationAt)) continue;

    const end = punctuationAt + m[1].length + m[2].length;
    ranges.push({ start, end });
    start = end + m[3].length;
  }

  if (start < text.length) ranges.push({ start, end: text.length });
  return ranges;
}

// Cut an over-long run into speakable pieces at the last clause break before the
// cap, falling back to the cap itself. The lower bound stops a comma near the
// start from producing a three-word fragment.
function chunk(words) {
  const chunks = [];
  for (let start = 0; start < words.length; ) {
    let end = Math.min(start + MAX_SENTENCE_WORDS, words.length);
    if (end < words.length) {
      for (let i = end - 1; i > start + MAX_SENTENCE_WORDS / 3; i--) {
        if (CLAUSE_BREAK.test(words[i].text)) {
          end = i + 1;
          break;
        }
      }
    }
    chunks.push(words.slice(start, end));
    start = end;
  }
  return chunks;
}

function sentencesFromPage(items, page, firstId) {
  const { text, words } = layout(wordsFromLines(linesFromItems(items)));
  const sentences = [];
  let cursor = 0;

  for (const range of sentenceRanges(text)) {
    const mine = [];
    while (cursor < words.length && words[cursor].start < range.end) mine.push(words[cursor++]);
    if (!mine.length) continue;

    for (const group of chunk(mine)) {
      const base = group[0].start;
      sentences.push({
        id: firstId + sentences.length,
        page,
        text: text.slice(base, group[group.length - 1].end),
        words: group.map((w) => ({
          text: w.text,
          start: w.start - base,
          end: w.end - base,
          rects: w.rects,
        })),
      });
    }
  }
  return sentences;
}

// The model itself. Pages are parsed strictly in order and only on demand, so a
// Sentence.id never shifts once assigned and a 700-page book does not have to be
// read up front.
export function create(parser) {
  const sentences = [];
  let parsedPages = 0;
  let queue = Promise.resolve();

  async function parseNextPage() {
    const page = parsedPages + 1;
    const items = await parser.textItems(page);
    sentences.push(...sentencesFromPage(items, page, sentences.length));
    parsedPages = page;
  }

  // Serialised: two callers asking for different pages must not interleave, or
  // pages would land out of order and ids would be wrong.
  function ensurePages(upTo) {
    const target = Math.min(Math.max(upTo, 0), parser.pageCount);
    queue = queue.then(async () => {
      while (parsedPages < target) await parseNextPage();
    });
    return queue;
  }

  return {
    pageCount: parser.pageCount,
    get parsedPages() {
      return parsedPages;
    },
    get sentences() {
      return sentences;
    },
    sentence(id) {
      return sentences[id];
    },
    ensurePages,
    ensureAll: () => ensurePages(parser.pageCount),
    sentencesOnPage: (page) => sentences.filter((s) => s.page === page),

    // Section 8's scanned-PDF case: a document whose first pages yield no words
    // has no text layer, so playback must not be offered. Looks past page 1
    // because a cover page is often a single image even in a text PDF.
    async hasText(probePages = 3) {
      await ensurePages(Math.min(probePages, parser.pageCount));
      return sentences.some((s) => s.words.length > 0);
    },
  };
}

// Exported for the node harness that checks splitting against real PDFs.
// Nothing in the extension should need it.
export const _internals = { linesFromItems, wordsFromLines, layout, sentenceRanges, sentencesFromPage };
