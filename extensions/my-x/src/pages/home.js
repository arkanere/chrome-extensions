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

/*
 * What counts as having read a post: half of the cell in the viewport, for one
 * continuous second. Not "rendered" — X renders far ahead of what you see —
 * and not "scrolled past", or one flick of the wheel would spend the day.
 */
const DWELL_MS = 1000;
const VISIBLE = 0.5;

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
 * The pass already knows every cell's post, so it records the id here and
 * hands the cell to the observer. X destroys cells rather than recycling them,
 * so a cell never holds a different post than the one first seen in it, and
 * both maps can be weak — there is nothing to clean up.
 *
 * A hidden cell is never observed: it is not on the screen, so it was never
 * read.
 */
const idOfCell = new WeakMap();
const observed = new WeakSet();
const dwelling = new Map();

const viewport = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const cell = e.target;

      if (!e.isIntersecting) {
        clearTimeout(dwelling.get(cell));
        dwelling.delete(cell);
        continue;
      }

      if (dwelling.has(cell)) continue;
      dwelling.set(
        cell,
        setTimeout(() => {
          dwelling.delete(cell);
          MyX.budget.saw(idOfCell.get(cell));
          MyX.tick();
        }, DWELL_MS)
      );
    }
  },
  { threshold: VISIBLE }
);

function watchCell(cell, post) {
  idOfCell.set(cell, post.postId);
  if (observed.has(cell)) return;
  observed.add(cell);
  viewport.observe(cell);
}

function unwatch(cell) {
  clearTimeout(dwelling.get(cell));
  dwelling.delete(cell);
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
      unwatch(cell);
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
