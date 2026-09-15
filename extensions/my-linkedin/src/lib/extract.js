/*
 * Reading one feed post out of the DOM.
 *
 * Everything that knows LinkedIn's markup lives in this file. When the filter
 * stops working, this is the only file to look at.
 *
 * Two things make LinkedIn harder than X or YouTube:
 *
 *   1. Every CSS class is a build hash — `.b7895f36`, `._130a2809`. There is
 *      not one semantic class name left on the page, and the hashes change
 *      whenever LinkedIn deploys. Class selectors are not an option here.
 *   2. What is left are `role`, `aria-label` and `componentkey`. Those are the
 *      anchors this file uses.
 */

/*
 * A feed post. `componentkey` on the card is
 * "update-card-focus<opaque id>FeedType_MAIN_FEED_RELEVANCE" — the prefix is
 * stable, the id is the post's identity, and role="listitem" separates cards
 * from the other listitems in the column ("Start a post", "Sort by").
 */
const POST_SELECTOR = 'div[role="listitem"][componentkey^="update-card-focus"]';

/*
 * The header button, which is the whole signal. LinkedIn offers exactly one of
 * these on a post by an account you are not already following:
 *
 *   aria-label="Follow Jane Doe"             the usual case
 *   aria-label="Invite Jane Doe to connect"  when it offers Connect instead
 *
 * The second was measured on one card in 23, and without it that post stayed.
 * On a post by an account you do follow there is no such button at all.
 */
const FOLLOW_SELECTOR =
  'button[aria-label^="Follow "], button[aria-label^="Invite "][aria-label$="to connect"]';

MyLI.extract = {
  posts() {
    return document.querySelectorAll(POST_SELECTOR);
  },

  read(node) {
    return {
      id: node.getAttribute("componentkey") || "",
      offered: !!node.querySelector(FOLLOW_SELECTOR),
      promoted: isPromoted(node),
    };
  },
};

/*
 * "Promoted" — an ad.
 *
 * Matched on a leaf element rather than on the card's text, because
 * textContent runs the page's words together with no separator
 * ("828,494 followersPromotedEvery interaction...") and a \b-anchored regex
 * over that string silently misses. Measured: 7 of 38 cards were ads, and the
 * naive whole-card regex found none of them.
 *
 * Ads carry no Follow button, so without this rule every one of them stays.
 */
function isPromoted(node) {
  for (const el of node.querySelectorAll("span, p, div")) {
    if (el.children.length) continue;
    if (el.textContent.trim() === "Promoted") return true;
  }
  return false;
}
