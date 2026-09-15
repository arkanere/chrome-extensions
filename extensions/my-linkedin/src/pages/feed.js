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

function pass() {
  if (!location.pathname.startsWith("/feed")) return;

  for (const node of MyLI.extract.posts()) {
    const post = MyLI.extract.read(node);
    node.classList.toggle(HIDDEN_CLASS, MyLI.rules.shouldHide(post));
  }
}

MyLI.onTick(pass);
