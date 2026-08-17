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
let groups = null; /* channelId -> group */
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

function updateCount(group) {
  const unseen = group.items.children.length;
  group.count.textContent = unseen ? unseen + " new" : "all seen";
  group.markAll.hidden = unseen === 0;
}

function markGroupSeen(group) {
  const cards = [...group.items.children];
  MyYT.seen.mark(cards.map((c) => c.dataset.myytId).filter(Boolean));

  for (const card of cards) {
    card.classList.add("myyt-seen");
    group.seenItems.appendChild(card);
  }
  updateCount(group);
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

  const markAll = document.createElement("button");
  markAll.className = "myyt-group__mark";
  markAll.textContent = "mark all seen";

  head.append(name, count, markAll);

  /* Unseen first, already-seen dimmed underneath. */
  const items = document.createElement("div");
  items.className = "myyt-group__items";

  const seenItems = document.createElement("div");
  seenItems.className = "myyt-group__items myyt-group__items--seen";

  section.append(head, items, seenItems);

  /*
   * Group order is fixed the first time a channel appears and groups only
   * ever grow. Without this the layout would reshuffle under you as more
   * cards load in.
   *
   * The continuation sentinel must stay last or YouTube stops loading.
   */
  const sentinel = contents.querySelector("ytd-continuation-item-renderer");
  contents.insertBefore(section, sentinel);

  const group = { section, items, seenItems, count, markAll };
  markAll.addEventListener("click", () => markGroupSeen(group));
  return group;
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

  card.dataset.myytId = video.videoId;

  if (MyYT.seen.has(video.videoId)) {
    card.classList.add("myyt-seen");
    group.seenItems.appendChild(card);
  } else {
    group.items.appendChild(card);
  }
  updateCount(group);
}

function scan(contents) {
  for (const card of contents.querySelectorAll("ytd-rich-item-renderer")) {
    processCard(card, contents);
  }

  if (unparsed) {
    const message =
      "could not parse " + unparsed + " cards (extract v" + MyYT.EXTRACT_VERSION + ")";
    console.warn("[my-youtube] " + message);
    MyYT.bar.say(message, true);
    unparsed = 0;
    return;
  }

  /* Resting state: what the feed currently holds. */
  let unseen = 0;
  for (const group of groups.values()) unseen += group.items.children.length;
  MyYT.bar.say(groups.size + " channels · " + unseen + " new");
}

/*
 * Clicking a card records it as seen but deliberately does not move it. The
 * card would jump out from under the pointer mid-click; the change shows up
 * next time the feed is built instead.
 */
function watchClicks(contents) {
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
    unparsed = 0;

    waitFor("ytd-browse[page-subtype='subscriptions'] ytd-rich-grid-renderer #contents", (contents) => {
      /* Seen state must be in memory before the first card is placed. */
      MyYT.seen.load().then(() => {
        scan(contents);
        watchClicks(contents);

        observer = new MutationObserver(() => scan(contents));
        observer.observe(contents, { childList: true });
      });
    });
  }
);
