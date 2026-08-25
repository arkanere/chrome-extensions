/*
 * DOM card -> video object.
 *
 * This is the fragile file. All knowledge of YouTube's markup lives here and
 * nowhere else, so when YouTube changes its DOM exactly one small file needs
 * fixing.
 *
 * Returns null for a card it cannot make sense of, rather than throwing. The
 * pass counts nulls and puts the count in the bar, so breakage is loud rather
 * than silent — a card we cannot read is left visible and left uncounted.
 *
 * YouTube is mid-migration: the homepage grid renders <yt-lockup-view-model>
 * with ytFooBarViewModel class names, while search results still use the older
 * ytd-* elements with ids. We read the new markup first and fall back to the
 * old, so both work.
 */

/*
 * Bumped whenever the selectors change. Shown with the parse-failure count in
 * the bar, so a stale extension (edited on disk but not reloaded in
 * chrome://extensions) is obvious instead of looking like a selector bug.
 */
MyYT.EXTRACT_VERSION = 3;

/* The cards in the homepage grid. Direct children of #contents. */
MyYT.CARD = "ytd-rich-item-renderer";

function cardText(el) {
  return el ? el.textContent.trim() : "";
}

/*
 * The channel a card belongs to.
 *
 * The key is the link's href — /@handle on the homepage — because that is
 * stabler than the display name, which can be renamed or localised. The name
 * is only ever shown to you, in the tag popup and the button's tooltip.
 *
 * In the new markup the channel link carries the name as its text. In the old
 * one the only channel link is sometimes the avatar, which holds an image and
 * no text, so the name is taken from the first metadata row instead.
 */
function findChannel(card) {
  const link = card.querySelector(
    'a[href^="/@"], a[href^="/channel/"], ytd-channel-name a, #channel-name a'
  );

  const name =
    cardText(link) ||
    cardText(card.querySelector(".ytContentMetadataViewModelMetadataRow"));
  if (!name) return null;

  const href = link ? link.getAttribute("href").split("?")[0].toLowerCase() : "";

  return { channelName: name, channelId: href || "name:" + name.toLowerCase() };
}

/*
 * A promoted card. It sits in the grid as an ordinary card and even carries a
 * /watch link, but it has no channel, so reading it would fail on every pass
 * and keep the bar permanently red.
 *
 * It is skipped, not hidden. Dropping ads would be a static hide on YouTube's
 * own promoted marker, which is a different job from "my tags" — and it is not
 * counted either, because the budget is for what you came to look at.
 */
MyYT.isAd = function (card) {
  return Boolean(card.querySelector("ytd-ad-slot-renderer"));
};

/*
 * The card's "..." button, which is what the tag button is put beside.
 *
 * In the new markup it sits in a wrapper of its own, absolutely positioned in
 * the metadata block — which is why the tag button is positioned rather than
 * inserted into a row (see tagger.js).
 */
MyYT.menuHost = function (card) {
  const menu = card.querySelector(
    "div.ytLockupMetadataViewModelMenuButton, ytd-menu-renderer"
  );
  return menu ? menu.parentElement : null;
};

MyYT.extract = function (card) {
  try {
    /*
     * A card YouTube has put in the grid but not filled in yet. It holds no
     * links at all, which is not something a finished card ever is, and it
     * gets its content a frame or two later.
     *
     * Told apart from breakage rather than lumped in with it: a card that has
     * a /watch link but nothing we can read *is* breakage and must stay loud,
     * while a card that is still being built would otherwise put a red count
     * in the bar on every page load and every scroll.
     */
    if (!card.querySelector("a[href]")) return { pending: true };

    /* A Shorts card links to /shorts/, never to /watch. clean.css already
     * hides these, but say so rather than counting it as a parse failure. */
    if (card.querySelector('a[href^="/shorts/"]')) return { isShort: true };

    const link = card.querySelector('a[href*="/watch?v="]');
    if (!link) return null;

    const videoId = (link.getAttribute("href").match(/[?&]v=([^&]+)/) || [])[1];
    if (!videoId) return null;

    /* Everything here is per channel, so a card without one is useless. */
    const who = findChannel(card);
    if (!who) return null;

    return {
      videoId,
      title:
        cardText(card.querySelector("a.ytLockupMetadataViewModelTitle")) ||
        cardText(card.querySelector("#video-title")) ||
        cardText(card.querySelector("h3")),
      channelId: who.channelId,
      channelName: who.channelName,
      isShort: false,
    };
  } catch (e) {
    return null;
  }
};
