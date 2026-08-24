/*
 * Your tags, and which of them are switched off.
 *
 * Two keys in chrome.storage.local:
 *
 *   tags   { "handle": ["politics", "crypto"] }   handle without the @
 *   hidden ["politics"]                           tags currently switched off
 *
 * Read synchronously through isHidden() after an awaited load(), because the
 * pass has to decide per cell with no chance to await.
 *
 * A new tag goes straight into hidden: tagging an account is how you hide it,
 * so it has to take effect the moment you press it. A tag no account carries
 * any more disappears from allTags() on its own — there is nothing to delete.
 */

const TAGS_KEY = "tags";
const HIDDEN_KEY = "hidden";

let byHandle = {};
let hidden = new Set();

/*
 * Nothing may be written before load() has answered. Until then byHandle is
 * an empty object that means "not read yet", not "you have no tags", and
 * writing it out erases everything you have.
 *
 * This is not hypothetical: budget.js once declared a top-level save() of its
 * own, which in the one shared content-script scope was replaced by this one,
 * and its first write — before load() had returned — wiped a day's tagging.
 * The name collision is fixed; this is the guard that makes the whole class
 * of mistake harmless.
 */
let tagsLoaded = false;

function save() {
  if (!tagsLoaded) return;
  chrome.storage.local.set({
    [TAGS_KEY]: byHandle,
    [HIDDEN_KEY]: [...hidden],
  });
}

function clean(tag) {
  return tag.trim().toLowerCase().replace(/\s+/g, " ");
}

MyX.tags = {
  async load() {
    const stored = await chrome.storage.local.get([TAGS_KEY, HIDDEN_KEY]);
    byHandle = stored[TAGS_KEY] || {};
    hidden = new Set(stored[HIDDEN_KEY] || []);
    tagsLoaded = true;
  },

  tagsFor(handle) {
    return byHandle[handle] || [];
  },

  /* Every tag in use, whether switched on or off. */
  allTags() {
    const all = new Set();
    for (const list of Object.values(byHandle)) for (const t of list) all.add(t);
    return [...all].sort();
  },

  isTagHidden(tag) {
    return hidden.has(tag);
  },

  isHidden(handle) {
    if (!handle) return false;
    for (const t of byHandle[handle] || []) if (hidden.has(t)) return true;
    return false;
  },

  add(handle, tag) {
    const t = clean(tag);
    if (!t) return;

    /* Asked before the tag is stored, or it is never new. */
    const isNew = !MyX.tags.allTags().includes(t);

    const list = (byHandle[handle] = byHandle[handle] || []);
    if (!list.includes(t)) list.push(t);

    /*
     * Tagging is hiding, so a brand-new tag arrives switched off. An existing
     * tag keeps whatever state you last put it in: if you have deliberately
     * switched "politics" back on for the evening, adding another account to
     * it must not switch it off again under you.
     */
    if (isNew) hidden.add(t);

    save();
  },

  remove(handle, tag) {
    const list = byHandle[handle];
    if (!list) return;
    const i = list.indexOf(tag);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) delete byHandle[handle];
    save();
  },

  setTagHidden(tag, off) {
    if (off) hidden.add(tag);
    else hidden.delete(tag);
    save();
  },
};

/*
 * Tag something in one tab and the other open tabs are stale until reloaded,
 * which reads as the extension having failed. Cheap to keep them in step.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[TAGS_KEY]) byHandle = changes[TAGS_KEY].newValue || {};
  if (changes[HIDDEN_KEY]) hidden = new Set(changes[HIDDEN_KEY].newValue || []);
  if (changes[TAGS_KEY] || changes[HIDDEN_KEY]) {
    MyX.bar.refreshTags();
    MyX.tickNow();
  }
});
