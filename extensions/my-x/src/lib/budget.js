/*
 * The daily post budget.
 *
 * X works because the supply never ends. This counts the posts you actually
 * look at on the home timeline and stops the timeline when you reach the
 * number you set. There is no off switch — the number is the only control,
 * and that is the point.
 *
 * One key in chrome.storage.local:
 *
 *   budget { date: "2026-08-25", ids: ["1234", ...], limit: 100 }
 *
 * ids rather than a bare count, for two reasons: the same post open in two
 * tabs must count once, and a reload must not lose the day. The list is
 * bounded by the limit, so it stays small.
 *
 * Read synchronously through count()/reached() after an awaited load(),
 * because the pass has to decide with no chance to await.
 */

const BUDGET_KEY = "budget";
const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;

let ids = new Set();
let limit = DEFAULT_LIMIT;
let day = null;

/* Local date, not UTC: the boundary that matters is your midnight. */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function adopt(record) {
  const r = record || {};
  limit = clampLimit(r.limit);
  day = r.date;
  ids = new Set(day === today() ? r.ids || [] : []);
}

function clampLimit(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, v));
}

function save() {
  day = today();
  chrome.storage.local.set({
    [BUDGET_KEY]: { date: day, ids: [...ids], limit },
  });
}

/*
 * The day can turn over while a tab sits open, so this is checked on every
 * read rather than only at load.
 */
function rollOver() {
  if (day === today()) return false;
  ids = new Set();
  save();
  return true;
}

MyX.budget = {
  DEFAULT_LIMIT,
  MIN_LIMIT,
  MAX_LIMIT,

  async load() {
    const stored = await chrome.storage.local.get(BUDGET_KEY);
    adopt(stored[BUDGET_KEY]);
  },

  get limit() {
    return limit;
  },

  count() {
    rollOver();
    return ids.size;
  },

  reached() {
    return MyX.budget.count() >= limit;
  },

  /* A view. No-op if this post is already counted, or the day is spent. */
  saw(postId) {
    if (!postId) return;
    rollOver();
    if (ids.has(postId) || ids.size >= limit) return;
    ids.add(postId);
    save();
    MyX.bar.refreshBudget();
  },

  setLimit(n) {
    /* A blank or half-typed field keeps the number you already had, rather
     * than dropping you back to the default under your hands. */
    if (!Number.isFinite(Number(n))) return;
    limit = clampLimit(n);
    save();
    MyX.bar.refreshBudget();
    MyX.tickNow();
  },
};

/*
 * Two X tabs share one budget, so a view counted in one has to reach the
 * other — otherwise each tab has its own allowance, which is no allowance.
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[BUDGET_KEY]) return;
  adopt(changes[BUDGET_KEY].newValue);
  MyX.bar.refreshBudget();
  MyX.tickNow();
});
