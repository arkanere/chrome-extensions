/*
 * "Discover more", on a post's own page.
 *
 * X ends the reply list with a block of posts it recommends — headed
 * "Discover more", subtitled "Sourced from across X" — that have nothing to do
 * with the post you opened. It reads as more replies and is not, so it goes.
 *
 * "Probable spam" is left alone. That section holds real replies to this post
 * that X has ranked down, and they are part of the conversation whatever X
 * thinks of them.
 *
 * Like the filter, hiding is display:none and nothing else — see home.js for
 * why nothing is moved or removed.
 */

/* Not .myx-hidden: home.js clears that class on every non-For-You page. */
const DISCOVER_CLASS = "myx-discover-hidden";

/*
 * The ids hidden so far, and the page they belong to.
 *
 * Needed because the list is virtualized. Scroll to the bottom and X unmounts
 * the "Discover more" heading while its posts are still on screen, so a pass
 * that only looked at the cells in front of it would lose the boundary and let
 * them back in. Once a post has been seen inside the section it stays hidden
 * for as long as you are on this post's page.
 */
let seenPath = null;
let recommended = new Set();

function unhideDiscover() {
  for (const c of document.querySelectorAll("." + DISCOVER_CLASS)) {
    c.classList.remove(DISCOVER_CLASS);
  }
}

function discoverPass() {
  /* A different post is a different set of recommendations. */
  if (location.pathname !== seenPath) {
    seenPath = location.pathname;
    recommended = new Set();
  }

  if (!MyX.power.enabled || !MyX.extract.statusId()) {
    unhideDiscover();
    return;
  }

  const root = MyX.extract.timelineRoot();
  if (!root) return;

  /*
   * The section is a flat run of cells: its heading, then its posts, then
   * either the next heading or the end of the list. There is no wrapper.
   */
  let inSection = false;

  for (const cell of root.querySelectorAll(MyX.extract.CELL)) {
    const heading = MyX.extract.headingKind(cell);

    if (heading) {
      inSection = heading === "recommended";
      cell.classList.toggle(DISCOVER_CLASS, inSection);
      continue;
    }

    if (inSection) {
      /* Unreadable cells inside the section are hidden anyway — a spacer
       * between two recommendations is still part of the block. */
      const post = MyX.extract.readCell(cell);
      if (post) recommended.add(post.postId);
      cell.classList.add(DISCOVER_CLASS);
      continue;
    }

    /* Outside a known section: hide only what we already know is one. */
    const post = MyX.extract.readCell(cell);
    cell.classList.toggle(
      DISCOVER_CLASS,
      Boolean(post) && recommended.has(post.postId)
    );
  }
}

MyX.onTick(discoverPass);
