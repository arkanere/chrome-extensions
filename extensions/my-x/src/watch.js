/*
 * The tick.
 *
 * There is no router here, because there is one page module. X fires no
 * navigation event of its own — no yt-navigate-finish equivalent — but it does
 * not need one: every view change rewrites the DOM, so the observer below
 * already sees it, and home.js re-checks which tab is showing on every pass.
 *
 * X also destroys and recreates timeline cells rather than recycling them
 * (measured on the live page), so every post appearing is a node insertion and
 * therefore a mutation. That is why there are no scroll-triggered passes:
 * unlike YouTube, there is no silent rebinding to catch.
 *
 * Content script files share one isolated-world global scope and run in
 * manifest order, so this file must be listed first.
 */

const MyX = (globalThis.MyX = {});

const TICK_MS = 200;

const listeners = [];
let timer = null;

MyX.onTick = function (fn) {
  listeners.push(fn);
};

/* Coalesced: the observer fires constantly on X, a pass re-reads every cell. */
MyX.tick = function () {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    run();
  }, TICK_MS);
};

/* For things you pressed yourself, where waiting 200ms would feel broken. */
MyX.tickNow = function () {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  run();
};

function run() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.error("[my-x] tick failed", e);
    }
  }
}

new MutationObserver(MyX.tick).observe(document.body, {
  childList: true,
  subtree: true,
});

/*
 * Scrolling too, because the budget reads which posts are on the screen and
 * that changes with no DOM change at all — X mutates constantly while you
 * scroll, but not on every pixel of it. Coalesced like everything else, and
 * passive so it cannot slow the scroll down.
 */
addEventListener("scroll", MyX.tick, { passive: true, capture: true });

/*
 * Deferred by a turn so the modules loaded after this file have registered
 * themselves first, then waits for the stored on/off state — no pass may run
 * before we know your tags and how much of the day is left.
 */
setTimeout(async () => {
  await MyX.budget.load();
  await MyX.tags.load();
  MyX.bar.refreshTags();
  MyX.tickNow();
}, 0);
