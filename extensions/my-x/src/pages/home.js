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
const BLOCKED_CLASS = "myx-blocked";
const PANEL_CLASS = "myx-panel";

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

/*
 * The viewport watch, for the budget.
 *
 * A post counts the moment any part of it reaches the screen. Not when X
 * renders it — X renders far ahead of what you can see, so that would spend
 * the day in one screenful — but there is no dwell time and no reading test
 * beyond that. A post you scrolled past is a post the feed spent on you,
 * whether you stopped on it or not; that is the thing being budgeted.
 *
 * The pass supplies the id for each cell, so a cell X destroys and recreates
 * mid-scroll is no problem: the id is what is counted, and budget.js counts
 * an id once. The maps are weak, so a destroyed node needs no cleanup.
 *
 * A hidden cell is never observed: it never reached the screen, so the feed
 * never spent it.
 */
const idOfCell = new WeakMap();
const observed = new WeakSet();

const viewport = new IntersectionObserver(
  (entries) => {
    let counted = false;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      MyX.budget.saw(idOfCell.get(e.target));
      counted = true;
    }
    if (counted) MyX.tick();
  },
  { threshold: 0 }
);

function watchCell(cell, post) {
  idOfCell.set(cell, post.postId);
  if (observed.has(cell)) return;
  observed.add(cell);
  viewport.observe(cell);
}

/*
 * A spent day. The cells are hidden by budget.css rather than removed, and one
 * panel of our own goes in the timeline root to say why — with the limit field
 * in it, so raising it is one place and not a hunt back up to the bar.
 */
function block(root) {
  root.classList.add(BLOCKED_CLASS);
  MyX.tagger.unstampAll();

  if (root.querySelector("." + PANEL_CLASS)) return;

  const panel = document.createElement("div");
  panel.className = PANEL_CLASS;

  const line = document.createElement("div");
  line.className = "myx-panel__line";
  line.textContent = `That is ${MyX.budget.limit} posts today.`;

  const sub = document.createElement("div");
  sub.className = "myx-panel__sub";
  sub.textContent = "The limit you set. The timeline comes back tomorrow.";

  panel.append(line, sub, MyX.bar.buildBudget());
  panel.querySelector(".myx-budget").myxRefresh();
  root.append(panel);
}

function unblock(root) {
  root.classList.remove(BLOCKED_CLASS);
  root.querySelector("." + PANEL_CLASS)?.remove();
}

function pass() {
  /*
   * null means extract could not tell which tab is showing — including every
   * page that is not the home timeline. Stand down rather than guess: failing
   * towards showing you everything is the only safe direction for a filter,
   * and the budget is a home-timeline thing, so there is nothing to count
   * here either.
   */
  const tab = MyX.extract.readTab();
  if (tab === null) {
    unhideAll();
    MyX.tagger.unstampAll();
    MyX.bar.say("idle");
    return;
  }

  const root = MyX.extract.timelineRoot();
  if (!root) return;

  if (MyX.budget.reached()) {
    block(root);
    MyX.bar.say("that is the day");
    return;
  }
  unblock(root);

  /*
   * Filtering is For You only — on Following you already chose who you see.
   * The budget covers both, because otherwise switching tabs is a free reset.
   */
  const filtering = tab === "foryou";
  if (!filtering) {
    unhideAll();
    MyX.tagger.unstampAll();
  }

  let failed = 0;

  for (const cell of root.querySelectorAll(MyX.extract.CELL)) {
    /* Cells also carry the composer, prompts and dividers. Not a failure. */
    if (!MyX.extract.isPost(cell)) continue;

    const post = MyX.extract.readCell(cell);
    if (!post) {
      failed++;
      continue;
    }

    const hide = filtering && shouldHide(post);
    if (filtering) cell.classList.toggle(HIDDEN_CLASS, hide);

    if (hide) {
      hiddenIds.add(post.postId);
    } else {
      if (filtering) MyX.tagger.stamp(cell, post);
      watchCell(cell, post);
    }
  }

  if (failed) {
    MyX.bar.say(
      `could not read ${failed} posts (extract v${MyX.EXTRACT_VERSION})`,
      true
    );
    return;
  }

  if (!filtering) {
    MyX.bar.say("counting");
    return;
  }

  const n = hiddenIds.size;
  MyX.bar.say(n === 1 ? "hidden 1 post" : `hidden ${n} posts`);
}

MyX.onTick(pass);
