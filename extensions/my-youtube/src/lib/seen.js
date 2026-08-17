/*
 * Which videos you have already looked at.
 *
 * Stored in chrome.storage.local as { videoId: timestamp }. Entries older than
 * 30 days are dropped on load so the map cannot grow forever — a video that
 * old has long since fallen off the feed, so remembering it buys nothing.
 *
 * Read synchronously through has() after an awaited load(), because the feed
 * has to decide where a card goes the moment it appears.
 */

const SEEN_KEY = "seen";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

let cache = {};

function save() {
  chrome.storage.local.set({ [SEEN_KEY]: cache });
}

MyYT.seen = {
  async load() {
    const stored = await chrome.storage.local.get(SEEN_KEY);
    cache = stored[SEEN_KEY] || {};

    const cutoff = Date.now() - MAX_AGE_MS;
    let pruned = false;
    for (const id of Object.keys(cache)) {
      if (cache[id] < cutoff) {
        delete cache[id];
        pruned = true;
      }
    }
    if (pruned) save();
  },

  has(videoId) {
    return Object.prototype.hasOwnProperty.call(cache, videoId);
  },

  mark(videoIds) {
    const now = Date.now();
    for (const id of videoIds) cache[id] = now;
    save();
  },
};
