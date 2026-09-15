/*
 * The filter pass.
 *
 * Runs on every tick and re-reads every post rather than trusting a mark from
 * the last pass. LinkedIn does both things that would break a cached decision:
 * it drops cards from the DOM as you scroll away (38 cards seen, 13 still
 * there), and it renders a card's header after the card itself appears — so a
 * post read too early has no header button yet and must be decided again.
 *
 * Hiding is display:none and nothing else. Never move a card, never remove
 * one: LinkedIn decides when to fetch more from the cards it is holding, and
 * taking nodes out from under it is what breaks infinite scroll.
 */

const HIDDEN_CLASS = "myli-hidden";

/*
 * The session's running total, for the bar. Ids rather than a counter, because
 * the pass re-decides every card on every tick and a counter would climb by
 * the size of the screen five times a second. Reset on reload, which is right:
 * the bar is answering "is this working, here, now".
 */
const hiddenIds = new Set();

function pass() {
  if (!location.pathname.startsWith("/feed")) return;

  for (const node of MyLI.extract.posts()) {
    const post = MyLI.extract.read(node);
    const hide = MyLI.rules.shouldHide(post);

    node.classList.toggle(HIDDEN_CLASS, hide);
    if (hide && post.id) hiddenIds.add(post.id);
  }

  MyLI.bar.setHidden(hiddenIds.size);
}

MyLI.onTick(pass);
