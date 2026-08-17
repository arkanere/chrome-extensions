/*
 * Tiny router.
 *
 * YouTube is a single-page app: it never reloads between pages, it fires
 * yt-navigate-finish instead. So page modules register a path test here and
 * the router re-runs them on every navigation.
 *
 * Content script files share one isolated-world global scope and run in
 * manifest order, so this file must be listed first.
 */

const MyYT = (globalThis.MyYT = { routes: [] });

MyYT.route = function (test, run) {
  MyYT.routes.push({ test, run });
};

function dispatch() {
  const path = location.pathname;
  for (const r of MyYT.routes) {
    if (!r.test(path)) continue;
    try {
      r.run(path);
    } catch (e) {
      console.error("[my-youtube] route failed", e);
    }
  }
}

/*
 * Deferred by a turn so the page modules loaded after this file have
 * registered themselves first. Still runs before first paint.
 */
setTimeout(dispatch, 0);

/* Fires on document and bubbles, so window catches every SPA navigation. */
window.addEventListener("yt-navigate-finish", dispatch);
