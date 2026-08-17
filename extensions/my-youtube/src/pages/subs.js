/*
 * The rebuilt subscription feed.
 *
 * We do not replace YouTube's grid, we rearrange it in place. Cards stay
 * YouTube's own elements AND stay direct children of #contents. We only insert
 * heading elements between them and reorder them behind their heading.
 *
 * Staying direct children is not a detail. YouTube keeps requesting more
 * videos while it believes #contents is underfilled. An earlier version moved
 * cards into nested containers of our own, so the grid saw its item list
 * emptying and loaded continuation after continuation — 11,000 videos deep,
 * with the page unusable. Never take cards out of #contents.
 *
 * Observe, don't drive: we never scroll the page ourselves. A MutationObserver
 * folds in cards as YouTube appends them during your own scrolling.
 */

const WATCHED_ENOUGH = 0.9;

/*
 * Safety net for the failure above. If cards ever arrive without end again,
 * stop and say so rather than letting the tab grind to a halt.
 */
const MAX_CARDS = 600;

let observer = null;
let contents = null;
let groups = null; /* channelId -> group */
let unparsed = 0;
let placed = 0;
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

  /*
   * Group order is fixed the first time a channel appears and groups only
   * ever grow, so the layout does not reshuffle as more cards load.
   *
   * The continuation sentinel must stay last or YouTube stops loading.
   */
  const sentinel = contents.querySelector("ytd-continuation-item-renderer");
  contents.insertBefore(head, sentinel);

  const group = { head, count, markAll, tail: head, cards: [] };
  markAll.addEventListener("click", () => markGroupSeen(group));
  return group;
}

function processCard(card) {
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
    group = makeGroup(video);
    groups.set(video.channelId, group);
  }

  card.dataset.myytId = video.videoId;
  if (MyYT.seen.has(video.videoId)) card.classList.add("myyt-seen");

  /* Move the card in behind its heading, still a direct child of #contents. */
  contents.insertBefore(card, group.tail.nextSibling);
  group.tail = card;
  group.cards.push(card);
  placed++;

  updateCount(group);
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
 * Put every card back behind its heading.
 *
 * Placing a card once is not enough. When YouTube loads a continuation it
 * re-syncs #contents against its own data model, which puts the cards back in
 * its order and strands our headings. So we re-assert the arrangement on every
 * scan, moving only the nodes that are actually out of place.
 */
function repair() {
  const sentinel = contents.querySelector("ytd-continuation-item-renderer");

  for (const group of groups.values()) {
    /* Our headings are foreign nodes in a container YouTube manages, so it
     * may drop them during a re-sync. Put one back rather than arranging
     * cards behind a heading that is no longer in the page. */
    if (group.head.parentNode !== contents) contents.insertBefore(group.head, sentinel);

    let prev = group.head;
    for (const card of group.cards) {
      /* Skip cards YouTube has removed: re-inserting would resurrect them. */
      if (card.parentNode !== contents) continue;
      if (prev.nextSibling !== card) contents.insertBefore(card, prev.nextSibling);
      prev = card;
    }
  }
}

function scan() {
  if (stopped) return;

  /*
   * Our own moves are childList changes too. Stop observing while we rearrange
   * or the observer would trigger itself without end.
   */
  if (observer) observer.disconnect();

  for (const card of contents.querySelectorAll("ytd-rich-item-renderer")) {
    processCard(card);
  }
  repair();

  if (observer && !stopped) {
    observer.takeRecords();
    observer.observe(contents, { childList: true });
  }

  if (placed > MAX_CARDS) {
    return halt("stopped at " + placed + " videos — the feed kept loading");
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
  for (const group of groups.values()) {
    unseen += group.cards.filter((c) => !c.classList.contains("myyt-seen")).length;
  }
  MyYT.bar.say(groups.size + " channels · " + unseen + " new");
}

/*
 * Clicking a card records it as seen but deliberately does not dim it yet. The
 * card would change under the pointer mid-click; it shows up dimmed next time
 * the feed is built instead.
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
    unparsed = 0;
    placed = 0;
    stopped = false;

    waitFor("ytd-browse[page-subtype='subscriptions'] ytd-rich-grid-renderer #contents", (el) => {
      contents = el;

      /* Seen state must be in memory before the first card is placed. */
      MyYT.seen.load().then(() => {
        scan();
        watchClicks();

        observer = new MutationObserver(() => scan());
        observer.observe(contents, { childList: true });
      });
    });
  }
);
