# my-x

A Chrome extension that makes X less annoying in four small ways. It caps how
many posts you read in a day, it lets you tag X accounts and drop everything
they post out of your For You feed, it gives you a one-click copy of a post's
text on the post's own page, and it takes the "Discover more" block off the
bottom of a post's replies.

The filtering does not replace the feed or fight the algorithm — the algorithm
stays exactly as it is, and we take out the part of it you have said you don't
want.

The jobs are unrelated and stay unrelated. Filtering is a For You thing; the
budget is a home-timeline thing, both tabs; copying and the "Discover more"
hide are status-page things. None of them knows about the others.

## Goals

1. Stop the home timeline once you have read the number of posts you set.
2. Tag any account, with your own free-form tags, from the post in front of you.
3. Hide every post from an account whose tag is switched off, on For You.
4. Flip a whole tag back on when you do want it, without untagging anything.
5. Copy the text of a post from the post's own page, without selecting it by
   hand and dragging in the header, the timestamp and the action bar with it.
6. End a post's replies where the replies end — no recommended posts from
   across X pretending to be part of the conversation.

## Non-goals

- No redirect to Following, no rebuilt timeline, no own API client. We read
  what X already rendered.
- No account/sync/backend. Everything is local to the browser.
- No post-level classification, by keyword or otherwise. Tags are per account.
- No off switch. A limit you can turn off in one click is not a limit, so the
  bar has a number and no bypass.
- We do not touch X's own Mute or Block. This layer is separate and private.
- Copy is the one post the URL points at, and its own text only. No walking a
  thread, no quoted post's text, no resolving X's shortened links.

## The one thing this cannot do

X picks what to send. We only delete some of it after it arrives. So the
algorithm keeps serving political posts and keeps finding new political
accounts you have never seen. Tagging is per account, which means every new
account gets one free pass into the feed before you can tag it.

The expectation, written down so it is a choice: this works well for the
twenty accounts that show up constantly, and it leaks at the edges forever.
If the leak turns out to be most of the problem, the next step is a keyword
layer over post text — a different, messier feature, deliberately out of scope.

## Architecture

Manifest V3 content script on `*://x.com/*` and `*://twitter.com/*`.

X is a single-page app and, unlike YouTube, fires no navigation event of its
own. `router.js` watches for the URL changing (a `MutationObserver` on the
document plus a `popstate` listener) and re-decides on each change whether the
current view is For You.

```
my-x/
  manifest.json
  src/
    bar.css              the extension's own bar, and room for it
    tagger.css           the tag button and its popup
    post.css             the copy button
    discover.css         the "Discover more" hide rule
    budget.css           a spent timeline, and its panel
    watch.js             the tick: one observer, coalesced to 200ms
    pages/
      home.js            the filter pass, and the budget's viewport watch
      post.js            the copy button          (a post's own page)
      discover.js        "Discover more" hidden   (a post's own page)
    lib/
      extract.js         DOM cell -> post object   (the fragile file)
      tags.js            handle -> tags, and which tags are hidden
      tagger.js          the per-post tag button and its popup
      bar.js             the bar: MyX.bar
      budget.js          the daily limit: MyX.budget
```

There is no router, even with two page modules. X fires no navigation event of
its own, but it does not need to: every view change rewrites the DOM, so the
single `MutationObserver` in `watch.js` already sees it, and each page module
re-decides on every pass whether it is on its own page — `home.js` re-reads
which tab is showing, `post.js` re-reads the URL. Both stand down when the
answer is no. `watch.js` is therefore just a coalesced tick, not a route table,
and the modules stay independent: neither can stop the other running.

Order matters in one place only. `post.js` is registered after `home.js`, so on
a status page `home.js` sets the bar to `idle` first and `post.js` can overwrite
it with a problem if it has one.

There is no `clean.css`. Nothing here is a static hide — every decision needs
to know who wrote the post — so there is nothing to inject at
`document_start`. A tagged post may therefore be briefly visible before the
first pass runs. Accepted.

## Where it applies

Five different answers, one per piece.

**The budget: the home timeline, both tabs.** For You *and* Following, because
otherwise switching tabs is a free reset. Everything else — a post's own page,
a profile, search, notifications — is never counted and never blocked: hitting
the limit ends the endless feed, it does not lock you out of X, and a link
someone sends you still opens.

**Filtering: For You only.** That means the home timeline (`/home` or `/`) **with the For You
tab selected**. Following, search results, replies, notifications, lists and
profile pages are left completely alone: on a profile you have gone there on
purpose, and on Following you already chose who you see.

Reading which tab is selected is a piece of DOM knowledge like any other, so it
lives in `extract.js` with the rest. If it cannot tell which tab is on, it
returns unknown and the extension stands down for that view rather than
guessing — failing towards showing you everything.

**"Discover more": a post's own page only.** It is a run of cells between two
heading cells, and there is no wrapper element to hide, so `discover.js` walks
the cell list and hides everything from the heading up to the next one. The
two headings — "Discover more" and "Probable spam" — carry no testid and both
labels are translated, so they are told apart by shape: only the
recommendation heading has a subtitle line under it.

The list is virtualized, and that costs one piece of state. Scrolled to the
bottom, X unmounts the "Discover more" heading while its posts are still on
screen — the boundary disappears and a pass that only read the cells in front
of it would let them back in. So every id hidden inside the section is
remembered for as long as you are on that post's page, and stays hidden. The
set is dropped when the path changes.

`discover.css` uses a class of its own rather than the filter's `.myx-hidden`,
because `home.js` clears every `.myx-hidden` on any page that is not For You —
a status page is exactly that — and the two passes would otherwise undo each
other on every tick.

**The copy button: a post's own page only.** `/<user>/status/<id>`, and on
that page only the one post the URL names. Not the timeline: a copy button on
every cell would be clutter on a page you are scrolling past, and the whole
point of copying is that you have stopped on something.

The tag button is not extended to the status page in return. You tag from the
feed, where you are deciding what you want less of; on a post's own page you
have gone there on purpose, and the only thing we add is copy.

**The bar: everywhere.** It is present on every X page and says `idle` where no
filtering happens. The bar is where your tags and your daily limit live, so
tying it to For You would mean the only way to switch a tag back on is to be standing
on the page it affects. Filtering stays For You only; the controls are always
reachable.

## Tags

Free-form strings, lowercased and trimmed. Two pieces of state in
`chrome.storage.local`:

```
tags   : { "handle": ["politics", "crypto"] }     handle without the @
hidden : ["politics"]                             tags currently switched off
```

A tag is created by typing it, and it goes straight into `hidden` — tagging an
account is how you hide it, so it has to take effect at once. Switching it back
on is one click on its chip in the bar. A tag with no accounts left on it
disappears by itself.

Accounts are keyed on the lowercase handle, because that is what the DOM
reliably gives us. An account that renames itself loses its tags and has to be
tagged again. Accepted.

Tagged accounts do not have to be accounts you follow — most of what For You
shows is not, and that is the whole point.

## The filter pass

For each post cell in the timeline, `extract.js` pulls out:

```
{ postId, author, repostedBy, quotedAuthor }
```

all handles, lowercase, `repostedBy` and `quotedAuthor` null when absent.

The three are not read the same way, because X does not render them the same
way. The author is a real profile link. The reposter has no link of its own —
the "N reposted" byline is wrapped in one, so it is read from the byline's
enclosing anchor. The quoted account has no link at all inside the quote card,
so its handle is read from the `@name` text. That last one is the weakest of
the three, and the most likely to need fixing later.

A post is hidden if **any** of those three handles carries a tag that is
currently in `hidden`. Either side of a repost or a quote is enough: it is the
content you are avoiding, not the messenger.

**Hidden means `display: none`, not removed.** Taking nodes out of a
virtualized timeline is how my-youtube once loaded eleven thousand videos. The
node stays where X put it, we only stop it being painted.

`display: none` was measured against the live feed: with half of every batch
hidden, the timeline kept loading normally — 36 new posts and 6000px of new
height over a minute of scrolling. It does not confuse X's loader.

One warning for anyone re-testing this: `window.scrollBy` in a loop wedges the
timeline on its own, with or without the extension. Early runs looked like
`display: none` had broken the feed, and a control run with no hiding at all
wedged in exactly the same way. Test with real wheel events only.

**X does not recycle cells — it destroys and recreates them.** This was
measured on the live page: over 149 passes while scrolling, not one cell node
was ever seen holding a different post than before, and cells scrolled far
enough away were removed from the DOM entirely.

That is the opposite of YouTube, and it makes this extension simpler than
`subs.js`. Every time a post appears it is a fresh node insertion, which fires
a mutation, so a `MutationObserver` sees everything. There is no need for the
scroll-triggered passes YouTube needs, because there is no silent rebinding to
catch. Passes are still coalesced to one every 200ms, and still re-read every
cell rather than trusting a mark from last time — cheap, and it means a cell
X recreates gets re-decided for free.

A cell `extract.js` cannot parse is left visible and counted. The count goes to
the bar in red, so breakage is loud rather than silent.

## The tag button

Each post gets a small button in its header row, next to the timestamp. Click
it and a popup opens under it holding:

- the account's current tags as chips — click one to take it off
- every other tag you have, as chips — click one to put it on
- a text field to type a new tag

Adding a tag hides the post immediately, along with everything else from that
account on screen. Removing the last hidden tag brings it back.

Because cells are recycled, the button is stamped per pass like everything
else, and the popup closes on scroll rather than trying to follow its post.

## The copy button

On a post's own page, one small button on the end of the post's action row —
after reply, repost, like, bookmark and share. Click it and the post's text is
on the clipboard. The icon becomes a check for about a second and a half, then
goes back. That is the whole feature.

`navigator.clipboard.writeText` inside the click handler, so it runs on the
user gesture and needs no extra permission.

The action row rather than the header, which is where the tag button goes in
the feed. That was tried first and does not work here: on a status page the
right-hand end of the header is a 28px-wide flex **column**, so a button put
beside the `...` stacks on top of it instead of sitting next to it. The action
row is a real horizontal row with room in it, and next to share is where
"copy the text" belongs anyway.

### Which post

The hard part, and the only thing here that can go wrong. A status page is not
one post: X renders the parents above it and the replies below it, every one of
them the same `article[data-testid="tweet"]` as the post you came for.

So the post is picked by identity, not by position: the status id in the URL is
matched against the `/status/` links inside each article. No match anywhere
means no button. **We never fall back to "probably the first one"** — a copy
button on the wrong reply hands you the wrong text and looks like it worked,
which is worse than no button at all. Same direction of failure as `readTab()`.

This is DOM knowledge, so it lives in `extract.js` with everything else that
knows what X's markup looks like.

### What lands on the clipboard

The post's text and nothing else. No handle, no timestamp, no URL — the URL is
already in the address bar, and the text is the part you cannot get without a
careful drag of the mouse.

Read by walking the text node, not by `textContent`, for one reason: X renders
emoji as twemoji images — `<img alt="😬" src=".../1f62c.svg">` — and
`textContent` drops them silently. The `alt` is the character itself, so
putting it back is the whole fix.

Line breaks need no work. X sets `white-space: pre-wrap` on the text and leaves
the newlines in the text nodes, which was measured on the live page. Adding a
newline for block-level elements as well, which sounds right, is actively
wrong: X wraps a `@mention` in an `inline-flex` div whose inner span is
`display: block`, so it breaks lines in the middle of a sentence.

A post with no text at all — an image on its own — gets no button, because
there is nothing to copy.

## The bar

Same idea as my-youtube's: a strip at the top saying the extension is here,
because a warning that only reaches the console is not a warning. Top, like
every other extension here — both readers have a sticky `<header>` and
my-youtube has `#myyt-bar` at `top: 0`.

**Making room for it** is the one place this fights X's layout. YouTube pins a
single thing to the top of the viewport, so my-youtube offsets it in CSS and is
done. X pins three: the left nav, the column's tab bar, and the search box.
Padding alone only moves normal flow, so those three would sit under the bar.

They are found by looking rather than by being named. Two of the three have no
stable handle, and naming them means three deep selectors into markup we do not
own. Instead `bar.js` walks the shallow structure of X's three columns and
pushes down anything pinned at `top: 0`. The depth limit is what makes this
both cheap and safe: about forty elements per pass, and it cannot reach inside
a post, so a pinned element within someone's tweet is never touched. X sets no
inline `top` on any of them, so there is nothing to fight over.

At rest it shows what it did — `hidden 23 posts` — followed by your tags as
chips. A chip is dim when the tag is hidden and bright when it is showing;
clicking it toggles that tag for every account carrying it. Problems, such as
`could not parse N cells (extract v1)`, appear in red with a dismiss button.

The count is for the session and resets on reload.

Toggling a chip re-runs the pass rather than reloading, since un-hiding is just
taking `display: none` off cells that are still sitting there.

### The limit control

At the right-hand end, where an off switch would otherwise be: `47 / [100]
today`, with the number editable in place. It is the only setting this
extension has. Changing it takes effect on the next tick, with no reload,
exactly like a tag chip.

It fires on `change` rather than on every keystroke: a half-typed `5` on the
way to `50` would otherwise block the feed under your hands.

## The daily budget

The feed is infinite, and infinite is the hook. Tagging takes out the part of
it you already know you do not want; the budget is about volume.

**What counts as a view.** A post half on screen — half of the post, or half
of the window if the post is taller than it — for one second. Not "rendered",
because X renders far ahead of what you can see, and not "scrolled past", or
one flick of the wheel would spend the day.

The second is **added up, not continuous**, and the time is added to the post
*id*, not to its DOM node. Both of those were learned the hard way: a timer
hung on a cell never fired at all, because X destroys and recreates cells as
you scroll and the node is swapped out from under the post you are reading.
Reading while the wheel is still turning has the same problem, on a smaller
scale.

So the `IntersectionObserver` runs at `threshold: 0` and does one job — say
which cells are worth measuring. A sampler every 250ms decides which of those
are actually being read, from their boxes, and adds the time. Measuring from
the box rather than from the observer's ratio is what gets long posts right:
half of a post taller than the window can never be on screen, and those are
the posts you spend the most time on.

Nothing accrues while the tab is in the background. A feed left open behind
your work is not a feed you are reading.

**Why home.js and not its own module.** The pass already walks every cell and
already has its post object, so it is the one place that knows a cell's id
without reading the DOM twice. The viewport watch hangs off that loop. A cell
hidden by a tag is never observed: it is not on the screen, so it was never
read.

`extract.js` needs nothing new. This is the first feature here that adds no
DOM knowledge at all.

**The state**, one key in `chrome.storage.local`:

```
budget { date: "2026-08-25", ids: ["1234", ...], limit: 100 }
```

Ids rather than a bare count, for two reasons: the same post open in two tabs
must count once, and a reload must not hand you a fresh day. The list is
bounded by the limit, so it stays small.

**The day boundary** is local midnight — the one that matters is yours, not
UTC. The date is checked on every read, not only at load, because a tab can
sit open across it.

**A spent day** hides every cell in the timeline with `display: none`, the
same mechanism and for the same reason as the filter, and puts one panel of
our own in the timeline root saying so. The limit field is in the panel, so
raising it is one place and not a hunt back up to the bar. No countdown, no
"ten more posts" button.

**It is not enforceable, and is not meant to be.** The storage can be cleared
from DevTools and the extension can be switched off in `chrome://extensions`.
This is a line you drew for yourself, not a lock — what it removes is the
frictionless part, which is the part that does the damage.

## No options page

The bar is the tag manager and the limit field. Everything you can configure
is one chip or one number.

## Build order

1. `manifest.json` + `router.js` + `extract.js` + `home.js`, with a hardcoded
   tag list. Proves the For You detection, the extraction and the recycling
   rule against the real page.
2. `tags.js` + the tag button. Now it is usable.
3. `bar.js` — count, chips, errors.
4. `budget.js` + the limit field, counting only. Watch the number climb on the
   real feed before anything is hidden by it.
5. `budget.css` + the block.
6. `post.js` + the copy button. Independent of everything above.

## Known trade-offs

Written down so they are choices rather than surprises later:

- The long tail leaks forever (see "The one thing this cannot do").
- The daily limit is a line, not a lock (see "The daily budget").
- A tagged post can flash before the first pass, because nothing can be hidden
  statically.
- Renaming an account loses its tags.
- X's Mute would hide an account *and* feed the algorithm a signal, which we
  cannot do. What this buys instead is grouping and bulk reversibility.
- Copy takes the post's text **as X rendered it**. Two consequences. Links come
  out in X's shortened display form, `example.com/some-lo…`, because the real
  href is a `t.co` redirect — neither string is the actual destination, and
  getting it would mean a network request this extension does not make. And a
  post X has truncated behind "Show more" copies truncated; expand it first.
- Copy is one post, not a thread. Copying an author's whole chain would mean
  guessing which surrounding cells belong to it, which is a second layer of
  guessing on markup we do not own.
- Ads and promoted posts are not touched, deliberately. Dropping them would be
  a static hide on X's own promoted marker, which is a different job from
  "my tags" and would bring back a `clean.css` this extension does not need.
