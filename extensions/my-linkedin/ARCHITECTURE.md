# my-linkedin — architecture

How the code is put together, and why it is shaped this way.

## The signal

LinkedIn offers a button in a post's header only when you are not already
following that account:

```
aria-label="Follow Jane Doe"              the usual case
aria-label="Invite Jane Doe to connect"   when it offers Connect instead
```

On a post by an account you do follow there is no such button at all. So the
presence of one answers exactly the question being asked, with no heuristic in
between — it is LinkedIn's own answer, live, on the post itself.

The Connect variant is not a detail: it was 1 card in 23, and without it that
post stayed.

Measured on a real feed, 38 cards:

| | count | |
| --- | ---: | --- |
| Follow / Connect offered on the card | 22 | not followed → hide |
| "Promoted" | 6 | an ad → hide |
| Neither | 10 | you follow them → keep |

Running the finished code against the live feed: 24 of 33 cards hidden. What
survived was five followed pages, one 1st-degree connection, one account marked
"Following", a group post, and the "Jobs recommended for you" module, which is
deliberately left alone.

### Two rules tried and rejected

**The grey line** — "Jane Doe likes this", "Suggested". This was the first plan,
and the feed disproved it: 4 of those 38 cards said someone liked or reposted a
post whose author you *already follow*. That rule throws those away; the
Follow-button rule keeps them. It also cannot see ads, because LinkedIn writes
"Promoted" in the actor's line rather than the grey one.

**The connection degree** — "2nd", "3rd+", "Following". Worse. Three authors you
follow were 2nd or 3rd+ degree, and one 1st-degree connection's post carried a
Follow button (the reshare trap below). Degree is about connection, not
following, and they are not the same thing.

### The alternative not built

Scrape the "Following" page once, store the list, keep only posts whose author
is on it. It needs a second page to scrape and goes stale as you follow people —
and the Follow button already answers the same question on the post. Not worth
it.

## What breaks it

- **Reshares.** When someone you follow reshares a stranger's post, the only
  Follow button on the card belongs to the *inner* author — so the card is
  hidden although its author is someone you follow. This is deliberate: it was
  1 card in 38, scoping the button to the card's own header costs a brittle
  depth-count or a name match, and a post that exists to show you a stranger's
  post is the thing being filtered out anyway. If a post you wanted keeps
  disappearing, this is the first suspect.
- **Group posts leak.** A post in a group you belong to carries no Follow
  button, so it stays even when its author is a stranger. Seen once, left alone.
- **Language.** We match `aria-label="Follow …"` / `"Invite … to connect"`, and
  the ad rule matches the word "Promoted". A LinkedIn in another language says
  something else and nothing gets hidden.
- **No stable class names.** Every class on the page is a build hash
  (`.b7895f36`), regenerated on deploy. We hang off `role`, `aria-label` and
  `componentkey` instead, which are far more stable, but nothing here is
  contractual. When it breaks, `src/lib/extract.js` is the only file to repair.

## Layout

Manifest V3 content script on `*://www.linkedin.com/*`. No build step, no
dependencies, no service worker, no popup.

```
src/watch.js        the tick — a coalesced MutationObserver, 200ms
src/lib/extract.js  reading a post out of the DOM (the only file that knows markup)
src/lib/rules.js    the keep/hide decision — no settings, both rules always on
src/lib/bar.js      the bar at the top: the name, and how many posts went
src/pages/feed.js   the pass over every visible post
src/feed.css        one rule: .myli-hidden { display: none }
src/bar.css         the bar, and the room it takes
src/clean.css       hides the right-hand rail — news, puzzles, the ad, the footer
```

The rail needs no pass: it is rendered once with the page rather than streamed
in like posts, so one CSS rule on `aside[aria-label="Aside"]` does it. LinkedIn
labels its two columns — the left is "Sidebar", the right is "Aside" — and the
right one exists on the feed and nowhere else, so the rule is feed-scoped by
the markup. The feed column is left where it is rather than re-centred.

A feed post is `div[role="listitem"][componentkey^="update-card-focus"]`. The
prefix is stable; the rest of the key is the post's identity, and it is what
the bar counts — the pass re-decides every card on every tick, so counting
cards rather than ids would climb by a screenful several times a second.

Making room for the bar is one CSS rule, which is unusual. LinkedIn pins
nothing to the viewport: `body` is `overflow: hidden` at viewport height, the
whole app lives in `#root` at that same height, and the scrolling happens
inside it. So the nav sits at the top because it is first in normal flow, and
shrinking `#root` by the bar's height moves everything down with it, with
nothing to re-apply on a view change. Padding `body` instead would push the
bottom of the app off the screen.

LinkedIn is a single-page app and fires no navigation event of its own, but
every view change rewrites the DOM, so the observer already sees it — there is
no router, and `feed.js` re-checks on each pass whether you are on `/feed`.

Hiding is `display: none` and nothing else. We never move a card and never
remove one: LinkedIn decides when to fetch more from the cards it is holding.

All content script files share one global scope, so `sh tools/scope-check.sh`
catches two files declaring the same top-level name.

## Two measurements that shape the code

- **Off-screen cards stay in the DOM** with their rendering skipped, so
  `innerText` returns `""` for them while `textContent` reads fine. Everything
  uses `textContent`.
- **`textContent` runs words together** with no separator —
  `"828,494 followersPromotedEvery interaction…"`. A `\b`-anchored regex over
  that string misses: it found 0 of the 7 ads on screen. Text matching is done
  per element, never over a whole card.
