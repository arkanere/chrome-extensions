/*
 * DOM card -> video object.
 *
 * This is the fragile file. All knowledge of YouTube's markup lives here and
 * nowhere else, so when YouTube changes its DOM exactly one small file needs
 * fixing.
 *
 * Returns null for a card it cannot make sense of, rather than throwing. The
 * feed counts nulls and logs them, so breakage is visible instead of silent.
 */

function text(el) {
  return el ? el.textContent.trim() : "";
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
    const channelLink = card.querySelector("ytd-channel-name a, #channel-name a");
    if (!channelLink) return null;

    /* The href (/@handle or /channel/UC...) is a stabler key than the
     * display name, which can be localised or renamed. */
    const channelId = channelLink.getAttribute("href");
    const channel = text(channelLink);
    if (!channelId || !channel) return null;

    const overlay = card.querySelector("ytd-thumbnail-overlay-time-status-renderer");
    const isLive = overlay ? overlay.getAttribute("overlay-style") === "LIVE" : false;

    const duration = text(
      card.querySelector(
        "ytd-thumbnail-overlay-time-status-renderer #text, badge-shape .badge-shape-wiz__text"
      )
    );

    /* YouTube draws the red watched bar by setting an inline width
     * percentage on #progress. No bar means unwatched. */
    const progress = card.querySelector("#progress");
    const watchedFraction =
      progress && progress.style.width
        ? (parseFloat(progress.style.width) || 0) / 100
        : 0;

    const metaSpans = card.querySelectorAll("#metadata-line span");
    const publishedText = metaSpans.length ? text(metaSpans[metaSpans.length - 1]) : "";

    return {
      videoId,
      title: text(card.querySelector("#video-title")),
      channel,
      channelId,
      duration,
      publishedText,
      isShort: false,
      isLive,
      watchedFraction,
    };
  } catch (e) {
    return null;
  }
};
