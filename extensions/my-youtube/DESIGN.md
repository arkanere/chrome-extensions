# my-youtube

A Chrome extension that reskins youtube.com into a quiet, subscription-first
site. It does not replace YouTube — it runs inside the real page, so login,
playback, history and subscriptions all keep working for free.

## Goals

1. Remove the noise. No recommendation homepage, no Shorts, no endscreen bait.
2. A subscription feed that is actually usable: grouped, filterable, and it
   remembers what you have already seen.

## Non-goals

- No own player. YouTube's player stays exactly as it is.
- No own API client. We read what the page already rendered.
- No account/sync/backend. State is local to the browser.
- Comments are left untouched.

## Architecture

Manifest V3 content script on `*://www.youtube.com/*`.

YouTube is a single-page app: it never reloads between pages, it fires
`yt-navigate-finish` instead. So the extension is a tiny router that watches
navigation and runs the right module for the current URL.

```
my-youtube/
  manifest.json
  src/
    clean.css            static hide rules, injected at document_start
    feed.css             layout for the rebuilt subscription feed
    router.js            watches yt-navigate-finish, dispatches by path
    pages/
      home.js            redirect / -> /feed/subscriptions
      watch.js           hide related column, endscreen, cards
      subs.js            rebuild the subscription feed
    lib/
      extract.js         DOM card -> video object   (the fragile file)
      seen.js            seen/unseen state in chrome.storage.local
      settings.js        read/write options
  options/
    options.html
    options.js
```

### Why the CSS is separate and static

Anything that is purely "hide this" goes in `clean.css`, declared in the
manifest so Chrome injects it at `document_start`. That means the noise is
never painted — no flash of Shorts before the JS wakes up. Only things that
need logic live in JS.

Selectors target custom element names and ids (`ytd-reel-shelf-renderer`,
`#related`, `#comments`), never obfuscated class names. Those element names are
YouTube's own component names and change rarely.

## The three pages

### Homepage — `home.js`

On `/`, immediately `location.replace('/feed/subscriptions')`. The
recommendation grid is also hidden in `clean.css` so it cannot flash during the
redirect.

### Watch page — `watch.js`

Mostly CSS: hide the `#secondary` column, drop the width cap on `#primary`, and
hide the in-player suggestion layers (end grid, creator end cards, info card
teaser and button, pause overlay).

The one thing CSS cannot do is resize the player. YouTube measures available
width in JavaScript and writes pixel sizes onto the player, so hiding the
related column leaves the video at its old size in dead space. `watch.js`
fires a `resize` event on the next frame — the same signal YouTube uses for a
real viewport change — to make it measure again.

### Subscription feed — `subs.js`

This is the real work, and the only part that is not a skin.

We **rearrange** YouTube's grid rather than replacing it. The cards stay
YouTube's own elements, moved into per-channel sections. Two reasons:

1. Lazy loading keeps working. YouTube loads more videos when a sentinel at the
   end of the grid scrolls into view. A hidden grid never fires it, and the
   feed would silently stop at the first batch.
2. Thumbnails, hover previews, menus and navigation keep working for free.

Steps:

1. Find the grid's `#contents`, waiting for it if the page is still building.
2. For each card in the DOM, `extract.js` pulls out:
   `{ videoId, title, channel, channelId, thumbnail, duration, publishedText,
      isShort, isLive, watchedFraction }`
3. Filter: drop Shorts, drop live, drop anything YouTube already shows as
   mostly watched.
4. Move each card into its channel's section, creating the section on first
   sight of that channel. New sections are inserted before the continuation
   sentinel, which must stay last or YouTube stops loading.
5. Seen videos are dimmed and sink below the unseen ones in their group.

**Seen state.** Stored in `chrome.storage.local` as `videoId -> timestamp`,
pruned to the last 30 days on load. A video is marked seen when you click it,
and each channel heading has a "mark all seen" button.

Clicking a card records it but deliberately does not move it — the card would
jump out from under the pointer mid-click. The change shows up next time the
feed is built. "Mark all seen" moves cards immediately, since that is the
point of pressing it.

The heading count shows unseen videos ("3 new"), not the total.

### Observe, don't drive

YouTube lazy-loads the feed: it renders roughly the first 30-40 videos and
fetches more only as you scroll. We do **not** scroll the page ourselves to
force the rest out of it.

Instead a `MutationObserver` watches the grid's `#contents`. When you scroll
normally and YouTube appends more cards, we extract and fold them into our
layout as they arrive. The feed is interactive immediately instead of stalling
while a script pumps the scrollbar.

The cost is that early grouping decisions are made on partial data. To stop the
layout reshuffling under you, channel group order is **fixed the first time a
channel appears** and later videos are appended into the existing group. Groups
never reorder once rendered; they only grow.

This means the feed shows what YouTube has loaded, not a guaranteed time
window. That is a deliberate trade: it removes the ugliest machinery in the
design, and matches how the page is actually used.

If partial coverage turns out to be a real problem, the upgrade is not
auto-scrolling — it is dropping the feed page as a data source and building the
feed from YouTube's per-channel RSS (`/feeds/videos.xml?channel_id=...`), which
is public, same-origin, and gives complete coverage per channel. That is a
larger change and is out of scope for now.

**Seen state.** A video is marked seen when you click through to it, and there
is a manual "mark all seen" per channel. Stored in `chrome.storage.local` as a
map of `videoId -> timestamp`, pruned to entries newer than 30 days so it never
grows without bound.

**Fragility.** All DOM knowledge lives in `extract.js` and nowhere else. When
YouTube changes its markup, exactly one small file needs fixing. `extract.js`
returns `null` for a card it cannot parse rather than throwing, and the feed
logs a count of unparsed cards so breakage is visible instead of silent.

## Options

A small options page with toggles, because not every rule should be
all-or-nothing:

- redirect homepage (on)
- hide Shorts (on)
- hide related sidebar (on)
- hide endscreen and cards (on)
- group feed by channel (on)
- hide seen videos entirely, instead of dimming (off)

## Build order

1. `manifest.json` + `clean.css` + `home.js`. Installable, already useful.
2. `watch.js`.
3. `extract.js` + `subs.js` read-only: rebuild the feed with no state,
   including the observer that folds in lazy-loaded cards.
4. `seen.js` and the seen/unseen behaviour.
5. Options page.

Each step is independently shippable.
