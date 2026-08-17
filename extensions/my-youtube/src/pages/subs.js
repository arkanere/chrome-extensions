/*
 * The rebuilt subscription feed.
 *
 * We do not replace YouTube's grid, we rearrange it. The cards stay YouTube's
 * own elements, moved into per-channel sections. Two reasons:
 *
 *  1. Lazy loading keeps working. YouTube loads more videos when a sentinel at
 *     the end of the grid scrolls into view. A hidden grid never fires it, and
 *     the feed would silently stop at the first batch.
 *  2. Thumbnails, hover previews, menus and navigation keep working for free.
 *
 * Observe, don't drive: we never scroll the page ourselves. A MutationObserver
 * folds in cards as YouTube appends them during your own scrolling.
 */

const WATCHED_ENOUGH = 0.9;

let observer = null;
let groups = null; /* channelId -> { section, items } */
let unparsed = 0;

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

function makeGroup(video, contents) {
  const section = document.createElement("div");
  section.className = "myyt-group";

  const head = document.createElement("div");
  head.className = "myyt-group__head";

  const name = document.createElement("span");
  name.className = "myyt-group__name";
  name.textContent = video.channel;

  const count = document.createElement("span");
  count.className = "myyt-group__count";

  head.append(name, count);

  const items = document.createElement("div");
  items.className = "myyt-group__items";

  section.append(head, items);

  /*
   * Group order is fixed the first time a channel appears and groups only
   * ever grow. Without this the layout would reshuffle under you as more
   * cards load in.
   *
   * The continuation sentinel must stay last or YouTube stops loading.
   */
  const sentinel = contents.querySelector("ytd-continuation-item-renderer");
  contents.insertBefore(section, sentinel);

  return { section, items, count, n: 0 };
}

function processCard(card, contents) {
  if (card.dataset.myytSeen) return;
  card.dataset.myytSeen = "1";

  const video = MyYT.extract(card);

  if (!video) {
    unparsed++;
    return;
  }

  if (video.isShort || video.isLive || video.watchedFraction >= WATCHED_ENOUGH) {
    card.classList.add("myyt-hidden");
    return;
  }

  let group = groups.get(video.channelId);
  if (!group) {
    group = makeGroup(video, contents);
    groups.set(video.channelId, group);
  }

  group.items.appendChild(card);
  group.n++;
  group.count.textContent = group.n === 1 ? "1 video" : group.n + " videos";
}

function scan(contents) {
  const cards = contents.querySelectorAll("ytd-rich-item-renderer");
  for (const card of cards) processCard(card, contents);

  if (unparsed) {
    console.warn("[my-youtube] could not parse " + unparsed + " cards");
    unparsed = 0;
  }
}

MyYT.route(
  (path) => path === "/feed/subscriptions",
  () => {
    /* Fresh state per navigation: YouTube rebuilds the grid each time. */
    if (observer) observer.disconnect();
    groups = new Map();
    unparsed = 0;

    waitFor("ytd-browse[page-subtype='subscriptions'] ytd-rich-grid-renderer #contents", (contents) => {
      scan(contents);

      observer = new MutationObserver(() => scan(contents));
      observer.observe(contents, { childList: true });
    });
  }
);
