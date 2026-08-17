# YouTube Ad Skipper

Clicks YouTube's **Skip** button the moment it turns clickable, so a skippable ad
is on screen for as little time as possible.

It does not block ads. The ad still starts, and YouTube still holds the button back
for its five seconds — this only removes the gap between "you may skip now" and
"you actually clicked".

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`extensions/youtube-extension`)

Nothing to configure and no toolbar button — once loaded it just works. Reload any
YouTube tab that was already open.

## How it works

`content.js` runs on `www.youtube.com` and `m.youtube.com`, and polls every 200ms
for a skip button that is clickable.

The polling deserves an explanation, since a `MutationObserver` looks like the
obvious choice. It isn't, because the button is not added when the countdown ends —
it is in the DOM for the whole ad, hidden or disabled, and becomes clickable when a
class or a style changes. Watching for that specific transition means observing
attributes across the player subtree, which is both more code and more callbacks
than a `querySelector` over three class names 5× a second. That query is cheap
enough that it doesn't register next to what YouTube's own page does.

"Clickable" means: not `disabled`, `offsetParent` is not null (that rules out
anything `display:none`, which is how the button spends the countdown), and the
box has a non-zero size.

## Logging — currently on

`DEBUG` at the top of `content.js` is `true`, so the extension narrates every ad to
the console. This is deliberate for now: the timings in the first version were
guesses, and the log is how we replace them with measurements. Set `DEBUG = false`
for silent everyday use.

Open DevTools on a YouTube tab (⌥⌘I), Console tab, filter on `yt-skip`:

```
[yt-skip] ad start  #1  "Ad 1 of 2"
[yt-skip]   +100ms  button in DOM (.ytp-skip-ad-button, hidden)
[yt-skip]  +5000ms  button clickable (.ytp-skip-ad-button)
[yt-skip]  +5175ms  CLICK  .ytp-skip-ad-button  (latency 175ms, poll is 200ms)
[yt-skip]  +5175ms  skipped — ad gone 0ms after click
[yt-skip] ad start  #2  "Ad 2 of 2"  (next in pod)
```

Times are relative to the start of that ad. The numbers to read:

- **latency** — the gap between the button becoming clickable and us clicking. This
  is the only delay we control, and it should land between 0 and `POLL_MS`. If it
  averages near 200ms rather than near 100ms, something other than the poll is
  costing us time.
- **which selector matched** — after a few sessions this says whether all three
  class names are live or two are dead weight.
- **ad gone Xms after click** — confirms the click actually worked. Its absence, or
  the `click had no effect` warning, would mean `.click()` is being rejected and we
  need a real pointer event sequence.
- **`unskippable`** — an ad that ran to the end with no button, so nothing to do.

### Why there are two loops

The clicker runs at `POLL_MS` (200ms); the watcher runs at `OBSERVE_MS` (25ms) and
never clicks. That gap is the point. If the watcher ran at the same 200ms as the
clicker, every button would appear to become clickable on the very tick we clicked
it, and the measured latency would always be ~0 — the poll's cost would be
invisible. Watching 8× faster makes that cost measurable, which is what tells us
whether 200ms is the right number.

The watcher is debug-only, so with `DEBUG = false` there is one 200ms loop and
nothing else.

## Permissions

None. A content script on a matched host needs no `permissions` entry, and there is
no service worker, no storage, and no network access.

## The class names will break

The one thing that will go stale. The skip button's class has changed several times,
and old names still turn up on some clients, so `content.js` matches all the ones
known to be in use:

| Selector | Era |
| --- | --- |
| `.ytp-skip-ad-button` | current |
| `.ytp-ad-skip-button-modern` | previous |
| `.ytp-ad-skip-button` | older still |

If skipping ever stops working, this list is why. Play an ad, right-click the skip
button → **Inspect**, and add whatever class it now carries to `SKIP_SELECTORS`.
Leave the old entries in place — they cost nothing and other clients still serve them.

## Limits

- **Only skippable ads.** Unskippable ones have no button, so there is nothing to click.
- **youtube.com only.** Videos embedded in other sites are out of scope; the script
  does not run in frames (`all_frames: false`).
- **Not YouTube Kids or music.youtube.com.** Add the host to `matches` if you want them.
