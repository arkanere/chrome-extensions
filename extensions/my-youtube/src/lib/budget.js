/*
 * The daily thumbnail budget.
 *
 * The homepage works because the supply never ends. This counts the videos the
 * homepage has actually put in front of you and freezes the grid when you
 * reach the number you set. There is no off switch — the number is the only
 * control, and that is the point.
 *
 * One key in chrome.storage.local:
 *
 *   budget { date: "2026-08-25", ids: ["dQw4...", ...], limit: 100 }
 *
 * ids rather than a bare count, for three reasons: the same video in two tabs
 * must count once, a reload must not hand you a fresh day, and the freeze
 * needs to know which cards were counted so it can leave them where they are.
 * The list is bounded by the limit, so it stays small.
 *
 * Read synchronously through count()/reached()/has() after an awaited load(),
 * because the pass has to decide with no chance to await.
 *
 * saveBudget() and not save(): every content script file shares one global
 * scope, tags.js has a save() of its own, and a second function of that name
 * here would silently replace it. That exact collision cost my-x a day of
 * tags. See tools/scope-check.sh.
 */

const BUDGET_KEY = "budget";
const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;

let seenIds = new Set();
let dayLimit = DEFAULT_LIMIT;
let budgetDay = null;

/* Same guard as tags.js: an empty set before load() means "not read yet". */
let budgetLoaded = false;

/* Local date, not UTC: the boundary that matters is your midnight. */
function todayStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function adoptBudget(record) {
  const r = record || {};
  dayLimit = clampLimit(r.limit);
  budgetDay = r.date;
  seenIds = new Set(budgetDay === todayStamp() ? r.ids || [] : []);
}

function clampLimit(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, v));
}

function saveBudget() {
  if (!budgetLoaded) return;
  budgetDay = todayStamp();
  chrome.storage.local.set({
    [BUDGET_KEY]: { date: budgetDay, ids: [...seenIds], limit: dayLimit },
  });
}

/*
 * The day can turn over while a tab sits open, so this is checked on every
 * read rather than only at load.
 */
function rollOver() {
  if (budgetDay === todayStamp()) return;
  seenIds = new Set();
  saveBudget();
}

MyYT.budget = {
  DEFAULT_LIMIT,
  MIN_LIMIT,
  MAX_LIMIT,

  async load() {
    const stored = await chrome.storage.local.get(BUDGET_KEY);
    adoptBudget(stored[BUDGET_KEY]);
    budgetLoaded = true;
  },

  get limit() {
    return dayLimit;
  },

  count() {
    rollOver();
    return seenIds.size;
  },

  reached() {
    return MyYT.budget.count() >= dayLimit;
  },

  /* Was this video part of today's spend? The freeze leaves these visible. */
  has(videoId) {
    rollOver();
    return seenIds.has(videoId);
  },

  /* A view. No-op if this video is already counted, or the day is spent. */
  saw(videoId) {
    if (!videoId) return;
    rollOver();
    if (seenIds.has(videoId) || seenIds.size >= dayLimit) return;
    seenIds.add(videoId);
    saveBudget();
    MyYT.bar.refreshBudget();
  },

  setLimit(n) {
    /* A blank or half-typed field keeps the number you already had, rather
     * than dropping you back to the default under your hands. */
    if (!Number.isFinite(Number(n))) return;
    dayLimit = clampLimit(n);
    saveBudget();
    MyYT.bar.refreshBudget();
    MyYT.tickNow();
  },
};

/*
 * Two YouTube tabs share one budget, so a view counted in one has to reach the
 * other — otherwise each tab has its own allowance, which is no allowance.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[BUDGET_KEY]) return;
  adoptBudget(changes[BUDGET_KEY].newValue);
  MyYT.bar.refreshBudget();
  MyYT.tickNow();
});
