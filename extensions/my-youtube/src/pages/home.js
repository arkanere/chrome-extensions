/*
 * The homepage is the recommendation engine's front door, so we never show it.
 * Landing on / goes straight to the subscription feed instead.
 *
 * replace() rather than assign() so the homepage does not sit in history and
 * trap the back button.
 */

MyYT.route(
  (path) => path === "/",
  () => {
    location.replace("/feed/subscriptions");
  }
);
