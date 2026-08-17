/*
 * DOM card -> video object.
 *
 * This is the fragile file. All knowledge of YouTube's markup lives here and
 * nowhere else, so when YouTube changes its DOM exactly one small file needs
 * fixing.
 *
 * Returns null for a card it cannot make sense of, rather than throwing. The
 * feed counts nulls and logs them, so breakage is visible instead of silent.
 *
 * YouTube is mid-migration: grid feeds now render <yt-lockup-view-model> with
 * ytFooBarViewModel class names, while search results still use the older
 * ytd-* elements with ids. We read the new markup first and fall back to the
 * old, so both work.
 */

/*
 * Bumped whenever the selectors change. Logged with the parse-failure count
 * so a stale extension (edited on disk but not reloaded in chrome://extensions)
 * is obvious instead of looking like a selector bug.
 */
MyYT.EXTRACT_VERSION = 2;

function text(el) {
  return el ? el.textContent.trim() : "";
}

/* "4:23" or "1:02:33", but not "LIVE" or "12K views". */
function isDuration(s) {
  return /^\d+(:\d{2})+$/.test(s);
}

function findChannel(card) {
  const link = card.querySelector(
    'a[href^="/@"], a[href^="/channel/"], ytd-channel-name a, #channel-name a'
  );

  /*
   * In the new markup the only channel link is often the avatar, which holds
   * an image and no text, while the name sits in the first metadata row. So
   * take the name and the id from wherever each is actually available.
   */
  const name = text(link) || text(card.querySelector(".ytContentMetadataViewModelMetadataRow"));
  if (!name) return null;

  /* The href is a stabler key than the display name, which can be renamed
   * or localised. Fall back to the name only when there is no link at all. */
  const href = link ? link.getAttribute("href").split("?")[0] : "";

  return { channel: name, channelId: href || "name:" + name };
}

function findDuration(card) {
  const badges = card.querySelectorAll(
    "yt-thumbnail-badge-view-model badge-shape, ytd-thumbnail-overlay-time-status-renderer #text"
  );
  for (const b of badges) {
    const t = text(b);
    if (isDuration(t)) return t;
  }
  return "";
}

function isLive(card) {
  const badges = card.querySelectorAll("yt-thumbnail-badge-view-model badge-shape");
  for (const b of badges) {
    if (/^live$/i.test(text(b))) return true;
  }
  const old = card.querySelector("ytd-thumbnail-overlay-time-status-renderer");
  return old ? old.getAttribute("overlay-style") === "LIVE" : false;
}

/*
 * The red watched bar is drawn by setting an inline width percentage. The
 * element holding it is named differently in each markup generation, so match
 * on the inline style and sanity-check the value instead.
 */
function findWatchedFraction(card) {
  const bars = card.querySelectorAll('[class*="rogress"] [style*="width"], #progress');
  for (const bar of bars) {
    const pct = parseFloat(bar.style.width);
    if (pct > 0 && pct <= 100) return pct / 100;
  }
  return 0;
}

MyYT.extract = function (card) {
  try {
    /* A Shorts card links to /shorts/, never to /watch. Detect before
     * bailing out on the missing watch link. */
    if (card.querySelector('a[href^="/shorts/"]')) {
      return { isShort: true };
    }

    const link = card.querySelector('a[href*="/watch?v="]');
    if (!link) return null;

    const videoId = (link.getAttribute("href").match(/[?&]v=([^&]+)/) || [])[1];
    if (!videoId) return null;

    /* Grouping is by channel, so a card without one is useless to us. */
    const who = findChannel(card);
    if (!who) return null;

    const rows = card.querySelectorAll(".ytContentMetadataViewModelMetadataRow");
    const publishedText = rows.length
      ? text(rows[rows.length - 1])
      : text(card.querySelector("#metadata-line span:last-of-type"));

    return {
      videoId,
      title:
        text(card.querySelector("a.ytLockupMetadataViewModelTitle")) ||
        text(card.querySelector("h3")) ||
        text(card.querySelector("#video-title")),
      channel: who.channel,
      channelId: who.channelId,
      duration: findDuration(card),
      publishedText,
      isShort: false,
      isLive: isLive(card),
      watchedFraction: findWatchedFraction(card),
    };
  } catch (e) {
    return null;
  }
};
