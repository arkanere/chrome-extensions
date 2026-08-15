// core/document-model — text runs become words and sentences. This is the pivot
// of the design: the renderer feeds it, playback consumes it, highlighting
// renders it.
//
// It imports nothing, and it never calls a DOM method. It is handed the run
// array that core/text-walk returns and treats each run's `node` as an opaque
// token it stores and hands back (4.2). That is what makes it runnable in plain
// node, which is how its sentence splitting was checked before Chrome saw it.
//
// The sentence half of this file — SENTENCE_END, ABBREVIATIONS, isAbbreviation,
// sentenceRanges, chunk, and the lazy in-order create() — is copied from
// pdf-reader unchanged, where it was validated against eight real documents.
// The geometry half of that file is deleted rather than ported: HTML has real
// word boundaries and the browser lays out the lines (2.2).

// A period after one of these is an abbreviation, not a sentence end. Kept
// deliberately short — the stance is to fix only what really breaks.
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
// they come out as one run of a hundred words or more. Synthesis latency grows
// with input size, so a run that long would stall playback with no place to
// pause. Anything over the cap is cut at the last clause break before it.
const MAX_SENTENCE_WORDS = 45;
const CLAUSE_BREAK = /[,;:)—]$/;

// Runs become one flat word list. A word is a maximal run of non-whitespace
// characters, and it may cross text nodes: `dis<em>connect</em>ed` arrives as
// three runs with no whitespace between them and is one word, whose range starts
// in the first node and ends in the last (4.1). `endNode` is what the
// highlighter needs to build that range; for a word inside a single node it is
// the same node as `node`.
//
// A break run closes the open word and starts a new block. Blocks are what stop
// a heading merging into the paragraph below it.
function blocksFromRuns(runs) {
  const blocks = [];
  let words = [];
  let open = null; // the word still being built, if the last run ended mid-word

  function endWord() {
    open = null;
  }

  function endBlock() {
    endWord();
    if (words.length) blocks.push(words);
    words = [];
  }

  for (const run of runs) {
    if (run.break) {
      endBlock();
      continue;
    }
    if (!run.text) continue;

    const matches = [...run.text.matchAll(/\S+/g)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];

      // Only a token starting at character 0 can continue the previous run's
      // word — anything later has whitespace in front of it.
      if (i === 0 && open && match.index === 0) {
        open.text += match[0];
        open.endNode = run.node;
        open.nodeEnd = match[0].length;
        continue;
      }

      const word = {
        text: match[0],
        node: run.node,
        nodeStart: match.index,
        endNode: run.node,
        nodeEnd: match.index + match[0].length,
      };
      words.push(word);
      open = word;
    }

    // The word stays open only if this run ended on a non-whitespace character,
    // so the next run's first token can join it. A run with no text nodes of its
    // own (a <br> separator) ends the word, as its text is whitespace.
    if (!/\S$/.test(run.text)) endWord();
  }

  endBlock();
  return blocks;
}

// Blocks of words become one section text: words joined by single spaces inside
// a block, blocks joined by a newline, each word carrying its offset into the
// result. The newline is never spoken — sentences are cut per block — but it
// keeps the offsets in 4.3's resume position stable and honest.
function layout(blocks) {
  let text = "";
  const placed = [];
  const spans = [];

  for (const words of blocks) {
    if (text) text += "\n";
    const start = text.length;

    for (const word of words) {
      if (text.length > start) text += " ";
      const wordStart = text.length;
      text += word.text;
      placed.push({ ...word, start: wordStart, end: text.length });
    }
    spans.push({ start, end: text.length });
  }

  return { text, words: placed, blocks: spans };
}

function isAbbreviation(text, periodAt) {
  const before = text.slice(0, periodAt);
  const token = (before.match(/\S+$/) || [""])[0];
  if (/^\p{Lu}$/u.test(token)) return true; // a single initial, as in "J. Smith"
  return ABBREVIATIONS.has(token.toLowerCase().replace(/[^\p{L}]/gu, ""));
}

// Character ranges over one block's text, one per sentence. Ranges never include
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

function sentencesFromRuns(runs, section, firstId) {
  const { text, words, blocks } = layout(blocksFromRuns(runs));
  const sentences = [];
  let cursor = 0;

  // Sentences are cut inside a block and never across one, so a heading, a list
  // item or a caption is always its own sentence however it is punctuated.
  for (const block of blocks) {
    const blockText = text.slice(block.start, block.end);

    for (const range of sentenceRanges(blockText)) {
      const end = block.start + range.end;
      const mine = [];
      while (cursor < words.length && words[cursor].start < end) mine.push(words[cursor++]);
      if (!mine.length) continue;

      for (const group of chunk(mine)) {
        const base = group[0].start;
        sentences.push({
          id: firstId + sentences.length,
          section,
          start: base,
          text: text.slice(base, group[group.length - 1].end),
          words: group.map((w) => ({
            text: w.text,
            start: w.start - base,
            end: w.end - base,
            node: w.node,
            nodeStart: w.nodeStart,
            endNode: w.endNode,
            nodeEnd: w.nodeEnd,
          })),
        });
      }
    }
  }

  return sentences;
}

// The model itself. Sections are parsed strictly in reading order and only on
// demand, so a Sentence.id never shifts once assigned and a 224-chapter book does
// not have to be rendered up front.
//
// `source` is `{ sectionCount, runs(n) }`. In the viewer that is the renderer
// plus core/text-walk; in the node harness it is an array of synthetic runs.
export function create(source) {
  const sentences = [];
  let parsedSections = 0;
  let queue = Promise.resolve();

  async function parseNextSection() {
    const section = parsedSections;
    const runs = (await source.runs(section)) || [];
    sentences.push(...sentencesFromRuns(runs, section, sentences.length));
    parsedSections = section + 1;
  }

  // Serialised: two callers asking for different sections must not interleave, or
  // sections would land out of order and ids would be wrong.
  function ensureSections(upTo) {
    const target = Math.min(Math.max(upTo, 0), source.sectionCount);
    queue = queue.then(async () => {
      while (parsedSections < target) await parseNextSection();
    });
    return queue;
  }

  return {
    sectionCount: source.sectionCount,
    get parsedSections() {
      return parsedSections;
    },
    get sentences() {
      return sentences;
    },
    sentence(id) {
      return sentences[id];
    },
    ensureSections,
    ensureAll: () => ensureSections(source.sectionCount),

    // A chapter that scrolled far away has its DOM dropped and, when it comes
    // back, is rebuilt from brand new text nodes — so every Word this model holds
    // for it points at a node that is no longer in the document. Highlighting and
    // click-to-read both need live nodes, so the caller re-walks the rebuilt
    // chapter and hands the runs back here.
    //
    // The bytes are the same both times, so the words must come out identical;
    // only their nodes differ. Anything else means the chapter did not rebuild
    // the way it was built, and the safe answer is to change nothing rather than
    // to bind half a chapter to the wrong nodes. Sentence ids never move either
    // way, because nothing is added or removed.
    rebindSection(section, runs) {
      if (section >= parsedSections) return false;

      const mine = sentences.filter((s) => s.section === section);
      const fresh = sentencesFromRuns(runs || [], section, 0);
      if (fresh.length !== mine.length) return false;

      for (let i = 0; i < mine.length; i++) {
        if (mine[i].text !== fresh[i].text) return false;
        if (mine[i].words.length !== fresh[i].words.length) return false;
      }

      // Checked in full before anything is written, so a mismatch late in the
      // chapter cannot leave the words before it rebound and the rest stale.
      for (let i = 0; i < mine.length; i++) {
        for (let w = 0; w < mine[i].words.length; w++) {
          const to = mine[i].words[w];
          const from = fresh[i].words[w];
          to.node = from.node;
          to.nodeStart = from.nodeStart;
          to.endNode = from.endNode;
          to.nodeEnd = from.nodeEnd;
        }
      }
      return true;
    },

    sentencesInSection: (section) => sentences.filter((s) => s.section === section),

    // 4.3's resume lookup: a saved { spineIndex, charOffset } becomes a sentence.
    // The offset is into the section's text, which is stable across changes to
    // the splitter in a way a sentence id is not. Falls back to the first
    // sentence starting after the offset, so a book that has been re-split still
    // lands within a line or two of where the reader stopped.
    //
    // The section must already be parsed; the caller does that, because awaiting
    // here would make a lookup look cheaper than it is.
    sentenceAtOffset(section, charOffset) {
      let after = null;

      for (const sentence of sentences) {
        if (sentence.section !== section) continue;
        const end = sentence.start + sentence.text.length;
        if (charOffset >= sentence.start && charOffset < end) return sentence;
        if (sentence.start >= charOffset && !after) after = sentence;
      }
      return after;
    },

    // Section 8's "book with no readable text" row. Looks past the first section
    // because a cover page is often a single image even in a text-heavy book.
    async hasText(probeSections = 3) {
      await ensureSections(Math.min(probeSections, source.sectionCount));
      return sentences.some((s) => s.words.length > 0);
    },
  };
}

// Exported for the node harness that checks splitting outside Chrome. Nothing in
// the extension should need it.
export const _internals = { blocksFromRuns, layout, sentenceRanges, chunk, sentencesFromRuns };
