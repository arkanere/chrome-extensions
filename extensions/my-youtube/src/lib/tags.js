/*
 * Your tags, and which of them are switched off.
 *
 * Two keys in chrome.storage.local:
 *
 *   tags   { "/@channel": ["politics", "gaming"] }   the channel's href
 *   hidden ["politics"]                              tags currently off
 *
 * Read synchronously through isHidden() after an awaited load(), because the
 * pass has to decide per card with no chance to await.
 *
 * A new tag goes straight into hidden: tagging a channel is how you hide it,
 * so it has to take effect the moment you press it. A tag no channel carries
 * any more disappears from allTags() on its own — there is nothing to delete.
 */

const TAGS_KEY = "tags";
const HIDDEN_KEY = "hidden";

let byChannel = {};
let hiddenTags = new Set();

/*
 * Nothing may be written before load() has answered. Until then byChannel is
 * an empty object that means "not read yet", not "you have no tags", and
 * writing it out erases everything you have. This is not hypothetical: it cost
 * my-x a day of tagging.
 */
let tagsLoaded = false;

function saveTags() {
  if (!tagsLoaded) return;
  chrome.storage.local.set({
    [TAGS_KEY]: byChannel,
    [HIDDEN_KEY]: [...hiddenTags],
  });
}

function cleanTag(tag) {
  return tag.trim().toLowerCase().replace(/\s+/g, " ");
}

MyYT.tags = {
  async load() {
    const stored = await chrome.storage.local.get([TAGS_KEY, HIDDEN_KEY]);
    byChannel = stored[TAGS_KEY] || {};
    hiddenTags = new Set(stored[HIDDEN_KEY] || []);
    tagsLoaded = true;
  },

  tagsFor(channelId) {
    return byChannel[channelId] || [];
  },

  /* Every tag in use, whether switched on or off. */
  allTags() {
    const all = new Set();
    for (const list of Object.values(byChannel)) for (const t of list) all.add(t);
    return [...all].sort();
  },

  isTagHidden(tag) {
    return hiddenTags.has(tag);
  },

  isHidden(channelId) {
    if (!channelId) return false;
    for (const t of byChannel[channelId] || []) if (hiddenTags.has(t)) return true;
    return false;
  },

  add(channelId, tag) {
    const t = cleanTag(tag);
    if (!t) return;

    /* Asked before the tag is stored, or it is never new. */
    const isNew = !MyYT.tags.allTags().includes(t);

    const list = (byChannel[channelId] = byChannel[channelId] || []);
    if (!list.includes(t)) list.push(t);

    /*
     * Tagging is hiding, so a brand-new tag arrives switched off. An existing
     * tag keeps whatever state you last put it in: if you have deliberately
     * switched "politics" back on for the evening, adding another channel to
     * it must not switch it off again under you.
     */
    if (isNew) hiddenTags.add(t);

    saveTags();
  },

  remove(channelId, tag) {
    const list = byChannel[channelId];
    if (!list) return;
    const i = list.indexOf(tag);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) delete byChannel[channelId];
    saveTags();
  },

  setTagHidden(tag, off) {
    if (off) hiddenTags.add(tag);
    else hiddenTags.delete(tag);
    saveTags();
  },
};

/*
 * Tag something in one tab and the other open tabs are stale until reloaded,
 * which reads as the extension having failed. Cheap to keep them in step.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[TAGS_KEY]) byChannel = changes[TAGS_KEY].newValue || {};
  if (changes[HIDDEN_KEY]) hiddenTags = new Set(changes[HIDDEN_KEY].newValue || []);
  if (changes[TAGS_KEY] || changes[HIDDEN_KEY]) {
    MyYT.bar.refreshTags();
    MyYT.tickNow();
  }
});
