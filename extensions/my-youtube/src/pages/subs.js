/*
 * The rebuilt subscription feed.
 *
 * We do not replace YouTube's grid, we rearrange it in place. Cards stay
 * YouTube's own elements and stay direct children of #contents. We only insert
 * heading elements between them and reorder them behind their heading.
 *
 * Two hard-won rules, both from bugs:
 *
 *  1. Never take cards out of #contents. YouTube keeps requesting more videos
 *     while it believes the grid is underfilled. An earlier version moved
 *     cards into nested containers of our own; the grid saw its item list
 *     emptying and loaded continuation after continuation, 11,000 videos deep.
 *
 *  2. Never trust a card to keep holding the same video. YouTube recycles card
 *     elements as you scroll, binding new data into an existing node. That
 *     fires no childList mutation, so a card filed under one channel silently
 *     becomes a video from another. Everything is therefore re-derived from
 *     the DOM on every pass; nothing is remembered about a card between passes.
 *
 * Observe, don't drive: we never scroll the page ourselves. A MutationObserver
 * folds in cards as YouTube appends them during your own scrolling.
 */

const WATCHED_ENOUGH = 0.9;

/* Safety net for rule 1: stop and say so rather than grinding the tab. */
const MAX_CARDS = 600;

/*
 * Bursts of mutations and scroll events are common; coalesce them into one
 * pass. A pass re-reads every card, so running one per frame would be wasteful
 * — a fifth of a second is soon enough to feel immediate.
 */
const SCAN_DELAY_MS = 200;

let observer = null;
let contents = null;
let groups = null; /* channelId -> group, in first-seen order */
let scanQueued = false;
let stopped = false;

function waitFor(selector, onFound) {
  const found = document.querySelector(selector);
  if (found) return onFound(found);

  const watcher = new MutationObserver(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    watcher.disconnect();
    onFound(el);
  });
  watcher.observe(document.documentElement, { childList: true, subtree: true });

  /* Give up rather than watch the whole document forever. */
  setTimeout(() => watcher.disconnect(), 15000);
}

function updateCount(group) {
  const unseen = group.cards.filter((c) => !c.classList.contains("myyt-seen")).length;
  group.count.textContent = unseen ? unseen + " new" : "all seen";
  group.markAll.hidden = unseen === 0;
}

function markGroupSeen(group) {
  const fresh = group.cards.filter((c) => !c.classList.contains("myyt-seen"));
  MyYT.seen.mark(fresh.map((c) => c.dataset.myytId).filter(Boolean));
  for (const card of fresh) card.classList.add("myyt-seen");
  updateCount(group);
}

function makeGroup(video) {
  const head = document.createElement("div");
  head.className = "myyt-group-head";

  const name = document.createElement("span");
  name.className = "myyt-group__name";
  name.textContent = video.channel;

  const count = document.createElement("span");
  count.className = "myyt-group__count";

  const markAll = document.createElement("button");
  markAll.className = "myyt-group__mark";
  markAll.textContent = "mark all seen";

  head.append(name, count, markAll);

  const group = { head, count, markAll, cards: [] };
  markAll.addEventListener("click", () => markGroupSeen(group));
  return group;
}

/* Stop YouTube loading any more by taking the sentinel out of view. */
function halt(reason) {
  stopped = true;
  if (observer) observer.disconnect();
  const sentinel = contents.querySelector("ytd-continuation-item-renderer");
  if (sentinel) sentinel.classList.add("myyt-hidden");
  MyYT.bar.say(reason, true);
}

/*
 * Read every card in the grid as it is right now, then arrange the grid to
 * match. Group order stays fixed at first sight of a channel — the groups map
 * is never reordered, only added to — so the layout does not reshuffle.
 */
function rebuild() {
  const cards = contents.querySelectorAll("ytd-rich-item-renderer");
  const byChannel = new Map();
  let unparsed = 0;

  for (const card of cards) {
    const video = MyYT.extract(card);

    if (!video) {
      unparsed++;
      continue;
    }

    if (video.isShort || video.isLive || video.watchedFraction >= WATCHED_ENOUGH) {
      card.classList.add("myyt-hidden");
      continue;
    }

    /* Re-stamped every pass, because the card may now hold a different video. */
    card.classList.remove("myyt-hidden");
    card.dataset.myytId = video.videoId;
    card.classList.toggle("myyt-seen", MyYT.seen.has(video.videoId));

    if (!groups.has(video.channelId)) groups.set(video.channelId, makeGroup(video));

    const list = byChannel.get(video.channelId);
    if (list) list.push(card);
    else byChannel.set(video.channelId, [card]);
  }

  const sentinel = contents.querySelector("ytd-continuation-item-renderer");
  let placed = 0;

  for (const [channelId, group] of groups) {
    group.cards = byChannel.get(channelId) || [];

    /* A channel can vanish entirely once its cards are recycled away. */
    group.head.hidden = group.cards.length === 0;

    /* Our headings are foreign nodes in a container YouTube manages, so it
     * may drop them during a re-sync. */
    if (group.head.parentNode !== contents) contents.insertBefore(group.head, sentinel);

    let prev = group.head;
    for (const card of group.cards) {
      if (prev.nextSibling !== card) contents.insertBefore(card, prev.nextSibling);
      prev = card;
    }

    placed += group.cards.length;
    updateCount(group);
  }

  return { placed, unparsed, total: cards.length };
}

/*
 * The first card still visible, and where it sits.
 *
 * Grouping means a newly loaded video joins its channel's group, which may be
 * far above the viewport. Everything below it then shifts down and the page
 * moves under you. Browsers do this correction themselves for appended
 * content, but not for nodes we move around, so we do it by hand.
 */
function anchorPoint() {
  for (const card of contents.querySelectorAll("ytd-rich-item-renderer")) {
    const box = card.getBoundingClientRect();
    if (box.bottom > 0) return { card, top: box.top };
  }
  return null;
}

function restoreAnchor(anchor) {
  if (!anchor || !anchor.card.isConnected) return;
  const moved = anchor.card.getBoundingClientRect().top - anchor.top;
  /* Sub-pixel drift is not worth a scroll, and scrolling would re-trigger us. */
  if (Math.abs(moved) > 1) window.scrollBy(0, moved);
}

function scan() {
  if (stopped) return;

  /*
   * Our own moves are childList changes too. Stop observing while we rearrange
   * or the observer would trigger itself without end.
   */
  if (observer) observer.disconnect();
  const anchor = anchorPoint();
  const result = rebuild();
  restoreAnchor(anchor);
  if (observer && !stopped) {
    observer.takeRecords();
    observer.observe(contents, { childList: true });
  }

  if (result.total > MAX_CARDS) {
    return halt("stopped at " + result.total + " videos — the feed kept loading");
  }

  if (result.unparsed) {
    const message =
      "could not parse " + result.unparsed + " cards (extract v" + MyYT.EXTRACT_VERSION + ")";
    console.warn("[my-youtube] " + message);
    MyYT.bar.say(message, true);
    return;
  }

  let unseen = 0;
  let channels = 0;
  for (const group of groups.values()) {
    if (!group.cards.length) continue;
    channels++;
    unseen += group.cards.filter((c) => !c.classList.contains("myyt-seen")).length;
  }
  MyYT.bar.say(channels + " channels · " + unseen + " new");
}

function requestScan() {
  if (scanQueued || stopped) return;
  scanQueued = true;
  setTimeout(() => {
    scanQueued = false;
    scan();
  }, SCAN_DELAY_MS);
}

/*
 * Clicking a card records it as seen but deliberately does not dim it yet. The
 * card would change under the pointer mid-click; it shows up dimmed on the
 * next pass instead.
 */
function watchClicks() {
  contents.addEventListener("click", (e) => {
    const card = e.target.closest("ytd-rich-item-renderer");
    if (card && card.dataset.myytId) MyYT.seen.mark([card.dataset.myytId]);
  });
}

MyYT.route(
  (path) => path === "/feed/subscriptions",
  () => {
    /* Fresh state per navigation: YouTube rebuilds the grid each time. */
    if (observer) observer.disconnect();
    groups = new Map();
    stopped = false;
    scanQueued = false;

    waitFor("ytd-browse[page-subtype='subscriptions'] ytd-rich-grid-renderer #contents", (el) => {
      contents = el;

      /* Seen state must be in memory before the first pass. */
      MyYT.seen.load().then(() => {
        scan();
        watchClicks();

        observer = new MutationObserver(requestScan);
        observer.observe(contents, { childList: true });

        /*
         * Recycling a card fires no mutation at all — YouTube binds new data
         * into a node that never moves. Scrolling is when that happens, so
         * scrolling is what tells us to look again.
         */
        window.addEventListener("scroll", requestScan, { passive: true });
      });
    });
  }
);
