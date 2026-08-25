# my-youtube

A Chrome extension that quietens youtube.com in four small ways. It takes out
the noise — Shorts, the up-next column, the endscreen bait. It lets you tag
channels and drop everything they post out of the homepage. It caps how many
videos the homepage may put in front of you in a day. And it does all of that
inside the real page, so login, playback, history and subscriptions keep
working for free.

It does not replace YouTube and it does not fight the algorithm. The algorithm
stays exactly as it is, and we take out the part of it you have said you don't
want.

The jobs are unrelated and stay unrelated. The hiding is static CSS on every
page; tagging and the budget are homepage things; the resize is a watch-page
thing. None of them knows about the others.

## Goals

1. Remove the noise: no Shorts, no up-next column, no endscreen bait.
2. Tag any channel, with your own free-form tags, from the card in front of you.
3. Hide every video from a channel whose tag is switched off, on the homepage.
4. Flip a whole tag back on when you do want it, without untagging anything.
5. Stop the homepage once it has shown you the number of videos you set.
6. Leave everything else exactly as YouTube ships it.

## Non-goals

- No own player, no own API client, no rebuilt feed. We read what YouTube
  already rendered.
- No account/sync/backend. Everything is local to the browser.
- No video-level classification, by keyword or otherwise. Tags are per channel.
- No off switch. A limit you can turn off in one click is not a limit, so the
  bar has a number and no bypass. (There used to be one; it went when the
  budget arrived.)
- We do not touch YouTube's own "Don't recommend channel". This layer is
  separate and private.
- The subscription feed, search, channel pages and comments are left untouched.

## The one thing this cannot do

YouTube picks what to send. We only delete some of it after it arrives. So the
algorithm keeps recommending, and keeps finding new channels you have never
seen. Tagging is per channel, which means every new channel gets one free pass
onto the homepage before you can tag it.

The expectation, written down so it is a choice: this works well for the twenty
channels that show up constantly, and it leaks at the edges forever.

## Architecture

Manifest V3 content script on `*://www.youtube.com/*`.

```
my-youtube/
  manifest.json
  src/
    clean.css            static hide rules, injected at document_start
    bar.css              the bar, its chips and its limit field, and room for it
    filter.css           hidden cards, the freeze, the tag button and popup
    router.js            watches yt-navigate-finish, dispatches by path
    tick.js              the tick: one observer plus scroll, coalesced to 200ms
    pages/
      home.js            the filter pass, and the budget's viewport watch
      watch.js           make the player re-measure once the column is gone
    lib/
      extract.js         DOM card -> video object   (the fragile file)
      tags.js            channel -> tags, and which tags are hidden
      tagger.js          the per-card tag button and its popup
      bar.js             the bar: MyYT.bar
      budget.js          the daily limit: MyYT.budget
```

Content script files share one isolated-world scope and run in manifest order,
so `router.js` is listed first: it creates the `MyYT` global that everything
else hangs off, and `tick.js` second.

**There are two dispatch mechanisms, on purpose.** YouTube is a single-page
app that fires `yt-navigate-finish`, and `router.js` is a tiny registry over
that: page modules call `MyYT.route(pathTest, run)` and it re-runs the matching
ones on every navigation. That is right for the watch page, where the work
happens the moment the page arrives and is then done.

It is useless for a feed, which keeps changing long after the navigation
finished. So `home.js` hangs off `tick.js` instead and re-checks the path on
every pass, exactly as `my-x` does. Nothing depends on route ordering.

### Why the tick needs scroll as well as mutations

Mutations catch the cards YouTube appends as you scroll. Scroll catches two
things mutations cannot.

Which cards are on the screen changes with no DOM change at all, and the budget
is a question about the screen.

And **YouTube recycles cards.** It binds a different video into a node that
never moves and fires no `childList` mutation, so a card can silently come to
hold something else. This is the opposite of X, where cells are destroyed and
recreated and one observer therefore sees everything, and it is why this
extension needs scroll passes where `my-x` does not.

The consequence runs through everything: **a pass trusts nothing it did last
time.** It re-reads every card and re-decides it, every 200ms at most. That is
what makes the recycling harmless — and it means a card YouTube rebinds is
re-decided for free.

## Where it applies

Four different answers, one per piece.

**The static hiding: everywhere.** Shorts in any feed, the sidebar entries, the
watch page's column and its in-player suggestions. See "What it hides".

**Filtering: the homepage only.** `/` and nowhere else. The subscription feed,
search, channel pages and the watch page are left completely alone: you went to
those on purpose, and on the subscription feed you already chose who you see.
Everything is undone on the way out, so leaving the homepage never leaves a
card hidden behind us.

**The budget: the homepage only.** Which leaves a hole, written down as a
choice: the subscription feed is an uncounted, unlimited feed. `my-x` closed
the equivalent hole by counting both home tabs. Here the homepage is the
endless part and the subscription feed is finite by definition, so it is left
alone.

**The bar: everywhere.** It says `idle` where no filtering happens. The bar is
where your tags and your daily limit live, so tying it to the homepage would
mean the only way to switch a tag back on is to be standing on the page it
affects.

## What it hides statically

**Shorts, everywhere.** Shelves of Shorts inside any feed, individual Shorts
sitting in a normal grid or in search results, and the Shorts entry in both the
full and the collapsed sidebar.

**Watch page.** The `#secondary` up-next column, the width cap on `#primary`,
and the in-player suggestion layers: the end grid, the creator's own end cards,
the info card teaser and its button, and the wall shown while paused.

Anything that is purely "hide this" goes in `clean.css`, declared in the
manifest so Chrome injects it at `document_start`. That means the noise is
never painted — no flash of Shorts before the JS wakes up.

Selectors target custom element names and ids (`ytd-reel-shelf-renderer`,
`#secondary`), never obfuscated class names. Those element names are YouTube's
own component names and change rarely.

Nothing in `filter.css` can work this way. Every decision there needs to know
who made the video, so a tagged card may be briefly visible before the first
pass runs. Accepted.

## Tags

Free-form strings, lowercased and trimmed. Two pieces of state in
`chrome.storage.local`:

```
tags   : { "/@channel": ["politics", "gaming"] }   the channel's href
hidden : ["politics"]                              tags currently switched off
```

A tag is created by typing it, and it goes straight into `hidden` — tagging a
channel is how you hide it, so it has to take effect at once. Switching it back
on is one click on its chip in the bar. A tag with no channels left on it
disappears by itself.

Channels are keyed on the link's href — `/@handle` on the homepage — because
that is stabler than the display name, which can be renamed or localised. The
name is stored alongside nothing; it is read fresh from the card each pass and
only ever shown to you, in the popup and the tooltip.

**Known leak.** A channel that appears as `/@handle` on one card and
`/channel/UC…` on another would have to be tagged twice. Homepage cards use
`/@handle` consistently, so this is accepted rather than resolved — resolving
it would mean a network request this extension does not make.

## The filter pass

For each card in the homepage grid, `extract.js` pulls out:

```
{ videoId, title, channelId, channelName, isShort }
```

A card is hidden if its channel carries a tag that is currently in `hidden`.

**Hidden means `display: none`, not removed.** `#contents` is a flat
`flex-wrap` container of `ytd-rich-item-renderer` children — measured on the
live page, no `ytd-rich-grid-row` in sight — so a hidden card simply drops out
and the rest close up. No holes.

**Never take a card out of `#contents`.** YouTube keeps requesting
continuations while it believes `#contents` is underfilled. An early version of
this extension moved cards into per-channel containers of its own; the grid saw
its item list emptying and loaded continuation after continuation, eleven
thousand videos deep, with the page unusable. Hiding is safe, moving is not.

Two cards are skipped rather than read. A Shorts card, which `clean.css` has
already hidden. And a promoted card — `ytd-ad-slot-renderer` — which sits in
the grid looking like a card and even carries a `/watch` link, but has no
channel at all: reading it would fail on every pass and keep the bar
permanently red. Ads are skipped, not hidden; dropping them is a different job
from "my tags".

A card `extract.js` cannot parse is left visible and left uncounted. The count
goes to the bar in red, so breakage is loud rather than silent.

## The tag button

Each card gets a small `#` button under its `...` menu. Click it and a popup
opens holding:

- the channel's current tags as chips — click one to take it off
- every other tag you have, as chips — click one to put it on
- a text field to type a new tag

Adding a tag hides the card immediately, along with everything else from that
channel on screen. Removing the last hidden tag brings it back.

It is *positioned*, not inserted into a row. YouTube's metadata block is a flex
row of avatar, text and the `...` button, and the `...` is itself absolutely
positioned in the block's top-right corner. There is no row to join, so the tag
button is absolutely positioned in the same corner, below it, where the channel
name and view count leave the right-hand side empty.

Because cards are recycled, the button is re-pointed at its card's current
video on every pass, and the popup closes on scroll rather than trying to
follow its card.

## The daily budget

The homepage is infinite, and infinite is the hook. Tagging takes out the part
of it you already know you do not want; the budget is about volume.

**What counts as a view.** Any part of a card reaching the screen. No dwell
time, no reading test: a thumbnail you scrolled past is a thumbnail the feed
spent on you.

The one line it draws is between *on screen* and *rendered*. YouTube renders
far ahead of what you can see, so counting what is in the DOM would spend the
day in a single screenful. Being on screen is a rect: `bottom > 0` and
`top < innerHeight`, measured in the pass that is already walking the cards.

An `IntersectionObserver` is the wrong tool and `my-x` proved it: Chrome only
computes intersections for a tab it is actually rendering, so a tab behind
another window counts nothing at all.

Counting is on the video id, never the node, because of the recycling.

**The state**, one key in `chrome.storage.local`:

```
budget { date: "2026-08-25", ids: ["dQw4...", ...], limit: 100 }
```

Ids rather than a bare count, for three reasons: the same video in two tabs
must count once, a reload must not hand you a fresh day, and the freeze needs
to know which cards were counted. The list is bounded by the limit, so it stays
small.

**The day boundary** is local midnight — the one that matters is yours, not
UTC. The date is checked on every read, not only at load, because a tab can sit
open across it.

### The freeze

A spent day does not blank the homepage. The grid freezes where it is: every
card you already spent stays exactly where it is and stays watchable,
everything else is hidden, and one panel of our own goes in at the bottom
saying so. The limit field is in the panel, so raising it is one place and not
a hunt back up to the bar.

**Hiding the continuation sentinel is what actually stops the feed**, and it
matters more than it looks. Hiding cards makes the page shorter, and a short
page is precisely what makes YouTube ask for another batch. Without taking
`ytd-continuation-item-renderer` out of view, the freeze would make the feed
load *harder*, not stop. The same mechanism was the safety net in the old
subscription feed.

The panel is our own element appended into `#contents`. That is safe — adding
elements there is what the old grouping code did for months. It is moving cards
*out* that breaks the grid.

**It is not enforceable, and is not meant to be.** The storage can be cleared
from DevTools and the extension can be switched off in `chrome://extensions`.
This is a line you drew for yourself, not a lock — what it removes is the
frictionless part, which is the part that does the damage.

## The bar

A strip across the top, present on every YouTube page. It says what the pass
did — `hidden 23 videos` — carries your tags as chips, and ends with
`47 / [100] today`, the limit editable in place. Problems, such as
`could not read 3 cards (extract v3)`, appear in red with a dismiss button.

The count of hidden videos is for the session and resets on reload. Toggling a
chip re-runs the pass rather than reloading, since un-hiding is just taking
`display: none` off cards that are still sitting there. The limit field fires
on `change` rather than on every keystroke: a half-typed `5` on the way to `50`
would otherwise freeze the grid under your hands.

**Making room for it** is additive on purpose. YouTube's masthead is fixed and
`#page-manager` carries a margin equal to the masthead height that YouTube sets
itself. Rather than recompute either number, push the masthead down by the bar
height and add the same amount as padding inside `#page-manager`. Both hold
whatever YouTube's own values are. (`my-x` needs a forty-element scan for this,
because X pins three separate things. YouTube pins one.)

The bar does not need to sniff the theme either: YouTube marks dark mode with a
`dark` attribute on `<html>`, which CSS can hang off directly.

## One global scope

Every content script file shares one scope, so a top-level `function save()` in
two files is not two functions — the later file silently replaces the earlier
one — and a duplicate `const` or `let` is worse, because it throws at load and
takes that whole file with it.

Both happened in `my-x` in one day, and cost a day of tags. Hence
`saveBudget()`, `saveTags()`, `tagsLoaded`, `budgetLoaded`, and
`sh tools/scope-check.sh`, which fails if any top-level name is declared in more
than one file. Run it before committing a new file.

The same shape of guard is in `tags.js` and `budget.js`: nothing may be written
before `load()` has answered, because an empty object before the read means
"not read yet", not "you have nothing".

## No options page

The bar is the tag manager and the limit field. Everything you can configure is
one chip or one number.

## Known trade-offs

Written down so they are choices rather than surprises later:

- The long tail leaks forever (see "The one thing this cannot do").
- The daily limit is a line, not a lock (see "The freeze").
- The subscription feed is uncounted, so it is an unlimited feed.
- A tagged card can flash before the first pass, because nothing that needs to
  know the channel can be hidden statically.
- A channel renaming its handle loses its tags.
- A channel appearing under both `/@handle` and `/channel/UC…` needs tagging
  twice.
- YouTube's own "Don't recommend channel" would hide a channel *and* feed the
  algorithm a signal, which we cannot do. What this buys instead is grouping
  and bulk reversibility.
- Ads are not touched, deliberately.
- If a hide rule stops working, YouTube renamed a component: fix the selector
  in `clean.css` or in `extract.js`, which is the only file that knows what
  YouTube's markup looks like.
