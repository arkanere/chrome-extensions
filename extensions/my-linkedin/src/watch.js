/*
 * The tick.
 *
 * There is no router here, because there is one page module and it re-checks
 * on every pass whether the feed is on screen. LinkedIn is a single-page app
 * that fires no navigation event of its own, but every view change rewrites
 * the DOM, so the observer below already sees it.
 *
 * Content script files share one isolated-world global scope and run in
 * manifest order, so this file must be listed first.
 */

const MyLI = (globalThis.MyLI = {});

const TICK_MS = 200;

const listeners = [];
let timer = null;

MyLI.onTick = function (fn) {
  listeners.push(fn);
};

/* Coalesced: LinkedIn mutates constantly, and a pass re-reads every post. */
MyLI.tick = function () {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    run();
  }, TICK_MS);
};

/* For things you pressed yourself, where waiting 200ms would feel broken. */
MyLI.tickNow = function () {
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
      console.error("[my-linkedin] tick failed", e);
    }
  }
}

new MutationObserver(MyLI.tick).observe(document.body, {
  childList: true,
  subtree: true,
});

/*
 * Deferred by a turn so the modules loaded after this file have registered
 * themselves first. Nothing is stored and nothing is awaited: the rules are
 * fixed, so the first pass can run immediately.
 */
setTimeout(MyLI.tickNow, 0);
