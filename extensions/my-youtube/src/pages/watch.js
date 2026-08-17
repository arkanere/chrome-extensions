/*
 * The watch page is almost entirely CSS (see clean.css). The one thing CSS
 * cannot do is resize the player.
 *
 * YouTube measures the available width in JavaScript and writes pixel sizes
 * onto the player. Hiding the related column with CSS does not tell it to
 * measure again, so the video keeps its old size and sits in dead space.
 * Firing a resize event is how YouTube itself is told the viewport changed,
 * so we reuse it to trigger the recalculation.
 *
 * On a frame boundary so the layout without the related column has settled
 * before YouTube reads the width back.
 */

MyYT.route(
  (path) => path === "/watch",
  () => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }
);
