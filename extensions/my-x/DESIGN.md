# my-x

A Chrome extension that makes X less annoying in two small ways. It lets you
tag X accounts and drop everything they post out of your For You feed, and it
gives you a one-click copy of a post's text on the post's own page.

The filtering does not replace the feed or fight the algorithm — the algorithm
stays exactly as it is, and we take out the part of it you have said you don't
want.

The two jobs are unrelated and stay unrelated. Filtering is a For You thing;
copying is a status-page thing. Neither knows about the other.

## Goals

1. Tag any account, with your own free-form tags, from the post in front of you.
2. Hide every post from an account whose tag is switched off, on For You.
3. Flip a whole tag back on when you do want it, without untagging anything.
4. Copy the text of a post from the post's own page, without selecting it by
   hand and dragging in the header, the timestamp and the action bar with it.

## Non-goals

- No redirect to Following, no rebuilt timeline, no own API client. We read
  what X already rendered.
- No account/sync/backend. Everything is local to the browser.
- No post-level classification, by keyword or otherwise. Tags are per account.
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
    watch.js             the tick: one observer, coalesced to 200ms
    pages/
      home.js            the filter pass          (For You)
      post.js            the copy button          (a post's own page)
    lib/
      extract.js         DOM cell -> post object   (the fragile file)
      tags.js            handle -> tags, and which tags are hidden
      tagger.js          the per-post tag button and its popup
      bar.js             the bar: MyX.bar
      power.js           the off switch: MyX.power
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

Three different answers, one per piece.

**Filtering: For You only.** That means the home timeline (`/home` or `/`) **with the For You
tab selected**. Following, search results, replies, notifications, lists and
profile pages are left completely alone: on a profile you have gone there on
purpose, and on Following you already chose who you see.

Reading which tab is selected is a piece of DOM knowledge like any other, so it
lives in `extract.js` with the rest. If it cannot tell which tab is on, it
returns unknown and the extension stands down for that view rather than
guessing — failing towards showing you everything.

**The copy button: a post's own page only.** `/<user>/status/<id>`, and on
that page only the one post the URL names. Not the timeline: a copy button on
every cell would be clutter on a page you are scrolling past, and the whole
point of copying is that you have stopped on something.

The tag button is not extended to the status page in return. You tag from the
feed, where you are deciding what you want less of; on a post's own page you
have gone there on purpose, and the only thing we add is copy.

**The bar: everywhere.** It is present on every X page and says `idle` where no
filtering happens. The bar is where your tags and the off switch live, so tying
it to For You would mean the only way to switch a tag back on is to be standing
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

Room is made whether the extension is on or off, because the bar is there
either way.

At rest it shows what it did — `hidden 23 posts` — followed by your tags as
chips. A chip is dim when the tag is hidden and bright when it is showing;
clicking it toggles that tag for every account carrying it. Problems, such as
`could not parse N cells (extract v1)`, appear in red with a dismiss button.

The count is for the session and resets on reload.

Toggling a chip re-runs the pass rather than reloading, since un-hiding is just
taking `display: none` off cells that are still sitting there.

### The off switch

At the right-hand end, one button: **turn off** / **turn on**. Off means the
extension stands down — no pass runs, no buttons are stamped, the bar stays
muted because it is the only way back on. The flag lives in
`chrome.storage.local` so it holds across tabs and restarts. Turning off
re-runs the pass to unhide everything; it does not need a reload, because
nothing has been moved or removed.

## No options page

The bar is the tag manager. Everything you can configure is one chip.

## Build order

1. `manifest.json` + `router.js` + `extract.js` + `home.js`, with a hardcoded
   tag list. Proves the For You detection, the extraction and the recycling
   rule against the real page.
2. `tags.js` + the tag button. Now it is usable.
3. `bar.js` — count, chips, errors.
4. `power.js` — the off switch.
5. `post.js` + the copy button. Independent of everything above.

## Known trade-offs

Written down so they are choices rather than surprises later:

- The long tail leaks forever (see "The one thing this cannot do").
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
