// store/settings — the only file that touches chrome.storage.
//
// Two things are kept, and they are kept apart on purpose:
//
//   prefs      { voice, rate }  — one set for the whole extension. A voice and a
//                                 speed are a property of the reader, not of a
//                                 particular article.
//   positions  { <url>: { charOffset, title, at } }
//                                 — keyed by the page's URL. epub-reader keys by
//                                 the SHA-256 of the file's bytes, because a book
//                                 moves between folders; a web page's identity is
//                                 its address, and there are no bytes to hash.
//
// It knows nothing about articles, speech or the DOM: keys and numbers in, keys
// and numbers out.
//
// A position is a character offset, not a sentence id (kept from epub-reader). A
// sentence id is an index into a list the splitter produced, so any later change
// to the splitter would silently move every saved position; a character offset
// does not. It also absorbs the thing books never had to worry about — an
// article's text can change between visits.

const PREFS_KEY = "prefs";
const POSITIONS_KEY = "positions";

// Each record is a few dozen bytes, so this is not about space — it is about not
// letting a map grow forever with articles opened once and never returned to.
// Oldest by last-read time are dropped first.
const MAX_POSITIONS = 200;

async function read(key, fallback) {
  try {
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? fallback;
  } catch (err) {
    // Storage failing is not a reason to refuse to read a book aloud.
    console.warn("[reading-mode] could not read settings:", err);
    return fallback;
  }
}

async function write(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    console.warn("[reading-mode] could not save settings:", err);
  }
}

export async function loadPrefs() {
  return read(PREFS_KEY, {});
}

// Merged rather than replaced, so saving a rate cannot forget a voice.
export async function savePrefs(changes) {
  await write(PREFS_KEY, { ...(await loadPrefs()), ...changes });
}

export async function loadPosition(url) {
  const positions = await read(POSITIONS_KEY, {});
  return positions[url] ?? null;
}

export async function savePosition(url, charOffset, title) {
  const positions = await read(POSITIONS_KEY, {});
  positions[url] = { charOffset, title, at: Date.now() };

  const keys = Object.keys(positions);
  if (keys.length > MAX_POSITIONS) {
    keys
      .sort((a, b) => (positions[a].at || 0) - (positions[b].at || 0))
      .slice(0, keys.length - MAX_POSITIONS)
      .forEach((key) => delete positions[key]);
  }

  await write(POSITIONS_KEY, positions);
}

export async function clearPosition(url) {
  const positions = await read(POSITIONS_KEY, {});
  if (!(url in positions)) return;
  delete positions[url];
  await write(POSITIONS_KEY, positions);
}
