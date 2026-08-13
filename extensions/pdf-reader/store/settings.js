// store/settings — the only file that touches chrome.storage.
//
// Two things are kept, and they are kept apart on purpose:
//
//   prefs      { voice, rate }  — one set for the whole extension. A voice and a
//                                 speed are a property of the reader, not of a
//                                 particular document.
//   positions  { <docKey>: { sentenceId, label, at } }
//                                 — keyed by the phase 2 hash of the PDF bytes,
//                                 so a file that moved or a signed URL that
//                                 expired still finds its place (section 4).
//
// It knows nothing about documents, speech or the DOM: keys and numbers in, keys
// and numbers out.

const PREFS_KEY = "prefs";
const POSITIONS_KEY = "positions";

// Each record is a few dozen bytes, so this is not about space — it is about not
// letting a map grow forever with documents opened once and never returned to.
// Oldest by last-read time are dropped first.
const MAX_POSITIONS = 200;

async function read(key, fallback) {
  try {
    const stored = await chrome.storage.local.get(key);
    return stored[key] ?? fallback;
  } catch (err) {
    // Storage failing is not a reason to refuse to read a PDF aloud.
    console.warn("[pdf-reader] could not read settings:", err);
    return fallback;
  }
}

async function write(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    console.warn("[pdf-reader] could not save settings:", err);
  }
}

export async function loadPrefs() {
  return read(PREFS_KEY, {});
}

// Merged rather than replaced, so saving a rate cannot forget a voice.
export async function savePrefs(changes) {
  await write(PREFS_KEY, { ...(await loadPrefs()), ...changes });
}

export async function loadPosition(docKey) {
  const positions = await read(POSITIONS_KEY, {});
  return positions[docKey] ?? null;
}

export async function savePosition(docKey, sentenceId, label) {
  const positions = await read(POSITIONS_KEY, {});
  positions[docKey] = { sentenceId, label, at: Date.now() };

  const keys = Object.keys(positions);
  if (keys.length > MAX_POSITIONS) {
    keys
      .sort((a, b) => (positions[a].at || 0) - (positions[b].at || 0))
      .slice(0, keys.length - MAX_POSITIONS)
      .forEach((key) => delete positions[key]);
  }

  await write(POSITIONS_KEY, positions);
}

export async function clearPosition(docKey) {
  const positions = await read(POSITIONS_KEY, {});
  if (!(docKey in positions)) return;
  delete positions[docKey];
  await write(POSITIONS_KEY, positions);
}
