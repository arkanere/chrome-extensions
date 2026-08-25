# my-youtube

A Chrome extension that quietens youtube.com. It does not replace YouTube — it
runs inside the real page, so login, playback, history and subscriptions all
keep working for free.

## Goals

1. Remove the noise: no Shorts, no up-next column, no endscreen bait.
2. Leave everything else exactly as YouTube ships it.

## Non-goals

- No own player. YouTube's player stays exactly as it is.
- No own API client. We read what the page already rendered.
- No account/sync/backend. State is local to the browser.
- The homepage, the subscription feed and comments are left untouched.

## Architecture

Manifest V3 content script on `*://www.youtube.com/*`.

```
my-youtube/
  manifest.json
  src/
    clean.css            static hide rules, injected at document_start
    bar.css              the extension's own bar, and room for it
    router.js            watches yt-navigate-finish, dispatches by path
    pages/
      watch.js           make the player re-measure once the column is gone
    lib/
      bar.js             the top bar and the off switch button
      power.js           the off switch: MyYT.power
```

Almost all of the work is static CSS. Only one thing needs logic, and it needs
to know which page you are on: YouTube is a single-page app, it never reloads
between pages, it fires `yt-navigate-finish` instead. So `router.js` is a tiny
registry — page modules call `MyYT.route(pathTest, run)` and the router re-runs
the matching ones on every navigation.

Content script files share one isolated-world scope and run in manifest order,
so `router.js` is listed first: it creates the `MyYT` global that everything
else hangs off.

## What it hides

**Shorts, everywhere.** Shelves of Shorts inside any feed, individual Shorts
sitting in a normal grid or in search results, and the Shorts entry in both the
full and the collapsed sidebar.

**Watch page.** The `#secondary` up-next column, the width cap on `#primary`,
and the in-player suggestion layers: the end grid, the creator's own end cards,
the info card teaser and its button, and the wall shown while paused.

## Why the CSS is separate and static

Anything that is purely "hide this" goes in `clean.css`, declared in the
manifest so Chrome injects it at `document_start`. That means the noise is
never painted — no flash of Shorts before the JS wakes up. Only things that
need logic live in JS.

Selectors target custom element names and ids (`ytd-reel-shelf-renderer`,
`#secondary`), never obfuscated class names. Those element names are YouTube's
own component names and change rarely.

## The watch page — `watch.js`

The one thing CSS cannot do is resize the player.

YouTube measures available width in JavaScript and writes pixel sizes onto the
player, so hiding the related column leaves the video at its old size in dead
space. `watch.js` fires a `resize` event on the next frame — the same signal
YouTube uses for a real viewport change — to make it measure again.

## The bar

A strip across the top saying the extension is here, and carrying the off
switch. It is injected into YouTube's page rather than owning the document, so
it also has to make room for itself.

Making room is additive on purpose. YouTube's masthead is fixed and
`#page-manager` carries a margin equal to the masthead height that YouTube sets
itself. Rather than recompute either number, push the masthead down by the bar
height and add the same amount as padding inside `#page-manager`. Both hold
whatever YouTube's own values are.

The bar shows no status. Everything the extension does is static hiding, so
nothing is running that could have something to report.

### The off switch

At the right-hand end of the bar is one button: **turn off** / **turn on**.

Chrome does not let an extension disable itself, so "off" means the extension
stands down on the page — `clean.css` stops matching, leaving YouTube exactly
as it ships. The bar itself stays, muted, because it is the only way back on.
The flag lives in `chrome.storage.local`, so it holds across tabs and restarts.
That flag is the only thing the extension stores, and the only reason it asks
for the `storage` permission.

`clean.css` is gated on `data-myyt="on"`, an attribute `power.js` puts on
`<html>`. A manifest stylesheet cannot be un-injected, so the switch takes the
attribute away instead. Reading storage is async but hiding has to be in place
before first paint, so the attribute goes on synchronously and only comes off
again if storage says the extension is off: being briefly clean while switched
off is harmless, the reverse would flash a page we mean to have cleaned.

Toggling reloads the page rather than flipping in place. Taking the attribute
off would un-hide everything, but the watch page would keep the player size it
measured while the related column was hidden, and switching back on would not
re-run the route. A reload gets both right for free, and this is a button
pressed rarely.

## No options page

Deliberately dropped. Every rule here is something we always want on, so a
page of toggles that are all switched on by default earns nothing and adds a
settings layer every module would have to read through.

If one rule later turns out to need turning off, that is the moment to add a
setting for it — not before.

The off switch in the bar is not a settings layer: it is all-or-nothing, it
lives where you already are, and only the router and one attribute read it.

## Fragility

The extension depends on YouTube's element names and ids and nothing else. If
a hide rule stops working, YouTube renamed a component: fix the selector in
`clean.css`. There is no DOM parsing, no stored state beyond one boolean, and
nothing that can silently produce a wrong result.
