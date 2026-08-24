/*
 * The filter pass.
 *
 * Runs on every tick, and re-reads every cell rather than trusting a mark from
 * the last pass. X destroys and recreates cells as you scroll, so a cell that
 * comes back has none of our classes on it and must be decided again; re-doing
 * the whole visible set is both simpler and cheaper than tracking which is
 * which.
 *
 * Hiding is display:none and nothing else. Never move a cell, never remove
 * one: X decides when to fetch more from the cells it is holding, and taking
 * nodes out from under a virtualized timeline is what once made my-youtube
 * load eleven thousand videos.
 */

const HIDDEN_CLASS = "myx-hidden";

/* Session totals, for the bar. Reset on reload, which is the point. */
const hiddenIds = new Set();

function unhideAll() {
  for (const c of document.querySelectorAll("." + HIDDEN_CLASS)) {
    c.classList.remove(HIDDEN_CLASS);
  }
}

/*
 * Either side of a repost or a quote is enough. It is the content you are
 * avoiding, not the messenger who passed it on.
 */
function shouldHide(post) {
  return (
    MyX.tags.isHidden(post.author) ||
    MyX.tags.isHidden(post.repostedBy) ||
    MyX.tags.isHidden(post.quotedAuthor)
  );
}

function pass() {
  if (!MyX.power.enabled) {
    unhideAll();
    MyX.tagger.unstampAll();
    return;
  }

  /*
   * null means extract could not tell which tab is showing. Stand down rather
   * than guess: failing towards showing you everything is the only safe
   * direction for a filter.
   */
  if (MyX.extract.readTab() !== "foryou") {
    unhideAll();
    MyX.tagger.unstampAll();
    MyX.bar.say("idle");
    return;
  }

  const root = MyX.extract.timelineRoot();
  if (!root) return;

  let failed = 0;

  for (const cell of root.querySelectorAll(MyX.extract.CELL)) {
    /* Cells also carry the composer, prompts and dividers. Not a failure. */
    if (!MyX.extract.isPost(cell)) continue;

    const post = MyX.extract.readCell(cell);
    if (!post) {
      failed++;
      continue;
    }

    const hide = shouldHide(post);
    cell.classList.toggle(HIDDEN_CLASS, hide);

    if (hide) hiddenIds.add(post.postId);
    else MyX.tagger.stamp(cell, post);
  }

  if (failed) {
    MyX.bar.say(
      `could not read ${failed} posts (extract v${MyX.EXTRACT_VERSION})`,
      true
    );
    return;
  }

  const n = hiddenIds.size;
  MyX.bar.say(n === 1 ? "hidden 1 post" : `hidden ${n} posts`);
}

MyX.onTick(pass);
