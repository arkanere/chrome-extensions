/*
 * The homepage pass: the tag filter, and the budget's viewport watch.
 *
 * Runs on every tick, and re-reads every card rather than trusting a mark from
 * the last pass. YouTube recycles cards — it binds a different video into a
 * node that never moves, with no mutation to announce it — so a card that has
 * our class on it may now hold something else entirely. Re-deciding the whole
 * visible set is both simpler and cheaper than tracking which is which.
 *
 * Hiding is display:none and nothing else. Never move a card, never remove
 * one, never take one out of #contents: YouTube keeps requesting continuations
 * while it believes #contents is underfilled, and moving cards into containers
 * of our own is what once made this extension load eleven thousand videos.
 */

const HIDDEN_CLASS = "myyt-hidden";
const FROZEN_CLASS = "myyt-frozen";
const PANEL_CLASS = "myyt-panel";

const GRID =
  "ytd-browse[page-subtype='home'] ytd-rich-grid-renderer #contents";
const SENTINEL = "ytd-continuation-item-renderer";

/* Session total, for the bar. Resets on reload, which is the point. */
const hiddenVideoIds = new Set();

function unhideAll() {
  for (const c of document.querySelectorAll("." + HIDDEN_CLASS)) {
    c.classList.remove(HIDDEN_CLASS);
  }
}

/*
 * The viewport watch, for the budget.
 *
 * A video counts the moment any part of its card reaches the screen. Not when
 * YouTube renders it — YouTube renders far ahead of what you can see, so
 * counting what is in the DOM would spend the day in one screenful — but there
 * is no dwell time and no test beyond that. A thumbnail you scrolled past is a
 * thumbnail the feed spent on you.
 *
 * Measured from the card's box in the pass, not with an IntersectionObserver.
 * The observer was tried in my-x and does not work: Chrome only computes
 * intersections for a tab it is actually rendering, so a tab sitting behind
 * another window counts nothing at all.
 *
 * Counting is on the video id, never the node, because of the recycling.
 */
function onScreen(card) {
  const r = card.getBoundingClientRect();
  return r.height > 0 && r.bottom > 0 && r.top < innerHeight;
}

/*
 * A spent day. The grid freezes where it is: everything already counted stays
 * exactly where it is and stays watchable, everything else is hidden, and
 * YouTube is stopped from fetching more.
 *
 * Hiding the continuation sentinel is what stops it. This matters more than it
 * looks: hiding cards makes the page shorter, and a short page is precisely
 * what makes YouTube ask for another batch. Without this the freeze would make
 * the feed load harder, not stop.
 */
function freeze(root) {
  MyYT.tagger.unstampAll();

  for (const child of root.children) {
    if (child.classList.contains(PANEL_CLASS)) continue;

    const keep =
      child.matches(MyYT.CARD) &&
      !MyYT.isAd(child) &&
      MyYT.budget.has(videoIdOf(child));

    child.classList.toggle(FROZEN_CLASS, !keep);
  }

  const sentinel = root.querySelector(SENTINEL);
  if (sentinel) sentinel.classList.add(FROZEN_CLASS);

  if (root.querySelector("." + PANEL_CLASS)) return;

  const panel = document.createElement("div");
  panel.className = PANEL_CLASS;

  const line = document.createElement("div");
  line.className = "myyt-panel__line";
  line.textContent = `That is ${MyYT.budget.limit} videos today.`;

  const sub = document.createElement("div");
  sub.className = "myyt-panel__sub";
  sub.textContent = "The limit you set. The homepage fills up again tomorrow.";

  panel.append(line, sub, MyYT.bar.buildBudget());
  panel.querySelector(".myyt-budget").myytRefresh();

  /* Appended into #contents, which is safe — heading elements of our own lived
   * here for months. It is moving cards *out* that breaks the grid. */
  root.append(panel);
}

function thaw(root) {
  for (const c of root.querySelectorAll("." + FROZEN_CLASS)) {
    c.classList.remove(FROZEN_CLASS);
  }
  root.querySelector("." + PANEL_CLASS)?.remove();
}

/* Only for the freeze, which needs an id from a card it is not otherwise
 * reading. A card whose id we cannot get is one the freeze hides. */
function videoIdOf(card) {
  const video = MyYT.extract(card);
  return video ? video.videoId : null;
}

function pass() {
  /*
   * The homepage and nowhere else. The subscription feed, search, a channel's
   * page and the watch page are all left completely alone: on those you have
   * gone there on purpose. Everything is undone on the way out, so leaving the
   * homepage never leaves a card hidden behind us.
   */
  if (location.pathname !== "/") {
    unhideAll();
    MyYT.tagger.unstampAll();
    MyYT.bar.say("idle");
    return;
  }

  const root = document.querySelector(GRID);
  if (!root) return;

  if (MyYT.budget.reached()) {
    freeze(root);
    MyYT.bar.say("that is the day");
    return;
  }
  thaw(root);

  let failed = 0;

  for (const card of root.querySelectorAll(MyYT.CARD)) {
    /* A promoted card has no channel and is not yours. Not a failure. */
    if (MyYT.isAd(card)) continue;

    const video = MyYT.extract(card);
    if (!video) {
      failed++;
      continue;
    }

    /* clean.css already hides these; there is nothing to tag or count. */
    if (video.isShort) continue;

    const hide = MyYT.tags.isHidden(video.channelId);
    card.classList.toggle(HIDDEN_CLASS, hide);

    if (hide) {
      hiddenVideoIds.add(video.videoId);
      continue;
    }

    MyYT.tagger.stamp(card, video);
    if (onScreen(card)) MyYT.budget.saw(video.videoId);
  }

  if (failed) {
    MyYT.bar.say(
      `could not read ${failed} cards (extract v${MyYT.EXTRACT_VERSION})`,
      true
    );
    return;
  }

  const n = hiddenVideoIds.size;
  MyYT.bar.say(n === 1 ? "hidden 1 video" : `hidden ${n} videos`);
}

MyYT.onTick(pass);
