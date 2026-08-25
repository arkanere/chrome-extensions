/*
 * The tick.
 *
 * router.js re-runs a page module once per navigation. That is right for the
 * watch page, where the work is done the moment the page arrives, and useless
 * for a feed, which keeps changing long after the navigation finished. So the
 * feed pass hangs off this instead: one coalesced tick, re-deciding everything
 * it can see, and re-checking on every pass which page it is on.
 *
 * Two signals feed it, and both are needed.
 *
 *   Mutations, because YouTube appends cards as you scroll.
 *
 *   Scroll, for two separate reasons. Which cards are on the screen changes
 *   with no DOM change at all, and the budget needs that. And YouTube
 *   *recycles* cards — it binds a different video into a node that never moves
 *   and fires no childList mutation, so a card can silently come to hold
 *   something else. Scrolling is when that happens, so scrolling is what tells
 *   us to look again.
 *
 * A pass therefore trusts nothing it did last time: it re-reads every card and
 * re-decides it. That is what makes the recycling harmless.
 *
 * Content script files share one isolated-world global scope and run in
 * manifest order, so this file is listed straight after router.js, which
 * creates the MyYT global.
 */

const TICK_MS = 200;

const tickListeners = [];
let tickTimer = null;

MyYT.onTick = function (fn) {
  tickListeners.push(fn);
};

/* Coalesced: YouTube mutates constantly, and a pass re-reads every card. */
MyYT.tick = function () {
  if (tickTimer) return;
  tickTimer = setTimeout(() => {
    tickTimer = null;
    runTick();
  }, TICK_MS);
};

/* For things you pressed yourself, where waiting 200ms would feel broken. */
MyYT.tickNow = function () {
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  runTick();
};

function runTick() {
  for (const fn of tickListeners) {
    try {
      fn();
    } catch (e) {
      console.error("[my-youtube] tick failed", e);
    }
  }
}

/* Content scripts run at document_start, so body may not exist yet. */
function startTick() {
  new MutationObserver(MyYT.tick).observe(document.body, {
    childList: true,
    subtree: true,
  });
  addEventListener("scroll", MyYT.tick, { passive: true, capture: true });
}

if (document.body) {
  startTick();
} else {
  document.addEventListener("DOMContentLoaded", startTick);
}

/*
 * Nothing may run before we know your tags and how much of the day is left:
 * the first pass would otherwise show a feed you have tagged away, and the
 * write guards in tags.js and budget.js would drop everything it counted.
 */
setTimeout(async () => {
  await MyYT.budget.load();
  await MyYT.tags.load();
  MyYT.bar.refreshTags();
  MyYT.tickNow();
}, 0);
