# my-linkedin — architecture

Manifest V3 content script on `*://www.linkedin.com/*`. No build step, no
dependencies, no permissions, no service worker, no popup.

```
src/watch.js        the tick — a coalesced MutationObserver, 200ms
src/lib/extract.js  reading a post out of the DOM (the only file that knows markup)
src/lib/rules.js    the keep/hide decision — no settings, both rules always on
src/lib/bar.js      the bar: the name, and how many posts went
src/pages/feed.js   the pass over every visible post
src/feed.css        one rule: .myli-hidden { display: none }
src/bar.css         the bar, and the room it takes
src/clean.css       hides the right-hand rail
```

## The signal

LinkedIn offers a button in a post's header only when you are not already
following that account:

```
aria-label="Follow Jane Doe"              the usual case
aria-label="Invite Jane Doe to connect"   when it offers Connect instead
```

A post by an account you follow has no such button. Measured on 38 cards: 22
offered one, 6 were ads, 10 were kept. The Connect variant was 1 in 23 — miss
it and that post stays.

Rejected: the grey line ("Jane Doe likes this") — 4 of the 38 were reactions to
posts by authors already followed, and it cannot see ads. Connection degree —
followed authors appear at 2nd and 3rd+, so degree answers a different
question. Scraping the Following page — goes stale, and the button already
answers it live.

## What breaks it

- **Reshares.** Someone you follow resharing a stranger's post is hidden: the
  only Follow button belongs to the inner author. Deliberate — 1 card in 38,
  and scoping it costs a brittle depth-count. First suspect if a post you
  wanted disappears.
- **Group posts leak.** No Follow button in a group you belong to, so a
  stranger's post there stays.
- **Language.** The aria-labels and "Promoted" are English. Another language
  hides nothing.
- **No stable class names.** Every class is a build hash (`.b7895f36`),
  regenerated on deploy. We use `role`, `aria-label` and `componentkey`
  instead. When it breaks, `src/lib/extract.js` is the only file to repair.

## The DOM facts that shape the code

- A post is `div[role="listitem"][componentkey^="update-card-focus"]`. The key
  is also the post's identity, which is what the bar counts.
- **Every pass re-reads every card.** LinkedIn drops cards as you scroll away
  and renders a card's header after the card appears, so no decision can be
  cached.
- **Hiding is `display: none`.** Never move or remove a card — LinkedIn decides
  when to fetch more from the cards it holds.
- **Off-screen cards stay in the DOM** with rendering skipped: `innerText`
  returns `""` for them, `textContent` reads fine.
- **`textContent` runs words together** — `"828,494 followersPromotedEvery…"`.
  A `\b`-anchored regex over a whole card found 0 of 7 ads. Text is matched per
  element.
- **Nothing is pinned to the viewport.** `body` is `overflow: hidden` at
  viewport height and the app lives in `#root` at that height, scrolling
  inside. So the bar shrinks `#root` — one rule, nothing to re-apply. Padding
  `body` would push the app's bottom off screen.
- **The rail is `aside[aria-label="Aside"]`** (the left column is "Sidebar"),
  rendered once with the page and present only on the feed — so one CSS rule,
  no pass, and feed-scoped by the markup.

No router: LinkedIn fires no navigation event, but every view change rewrites
the DOM, so the observer sees it and `feed.js` re-checks the path each pass.

All content script files share one global scope — `sh tools/scope-check.sh`
catches two files declaring the same top-level name.
