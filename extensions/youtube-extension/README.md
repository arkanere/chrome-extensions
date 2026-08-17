# YouTube Ad Skipper

Ends a YouTube ad the moment it becomes skippable, so it is on screen for as little
time as possible.

It does not block ads. The ad still starts, and YouTube still holds its five second
countdown — this only removes the gap between "you may skip now" and the ad
actually going away.

Despite the name it does **not** press the Skip button. Pressing it does not work;
see below. The button's appearance is used as the signal that the ad is allowed to
end, and the ad is then seeked past.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`extensions/youtube-extension`)

Nothing to configure and no toolbar button — once loaded it just works. Reload any
YouTube tab that was already open.

## How it works

`content.js` runs on `www.youtube.com` and `m.youtube.com`, and polls every 200ms
for a skip button that is clickable — the signal that this ad may now end.

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

## Why it seeks instead of pressing the button

This started out clicking the skip button. That does not work, and the logs are what
proved it — two rounds against real ads:

1. `el.click()` — button stayed put, ad played on, and we re-clicked every 200ms
2. a full pointer sequence (`pointerover → pointerdown → mousedown → pointerup →
   mouseup → click`) dispatched at whatever `elementFromPoint` reported at the
   button's centre — same result

The `STUCK` dump ruled out the boring explanations. Exactly one element matched, and
the hit test at its centre landed on the button itself, so nothing was overlaying it
and no ghost element was being matched:

```
<button class="ytp-skip-ad-button" id="skip-button:2">
  <div class="ytp-skip-ad-button__text">Skip</div>
```

What is left is `isTrusted`. Events made by script carry `isTrusted: false`, and a
content script cannot forge a trusted one — only `chrome.debugger` can, which needs
a permission that puts a warning banner across the browser. Pressing the button is a
dead end, not a bug waiting to be fixed, so both click attempts were **deleted**
rather than kept as dead fallbacks.

**What works: `video.currentTime = video.duration`.** No handler is involved at all —
the video element moves, and YouTube plays the content once the ad runs out.

### It retries, and that part is not optional

The seek is re-applied every poll for as long as the ad is skippable. This is the
whole lesson of an ad pod that showed up in testing: the **first** ad refused a seek
at +5.8s and played on to +13s, while the second obeyed within 25ms.

A seek to a time outside `video.seekable` is silently refused, and an ad is not
always buffered to its end at the moment its skip button appears. One attempt is
therefore a coin flip; retrying costs one assignment per tick and turns it into a
certainty. The log distinguishes the two cases, because `currentTime` read straight
back says whether the seek was taken:

```
[yt-skip]  +6375ms  seek refused 7 times — retrying every 200ms
[yt-skip]     currentTime 6.00 of duration 15.00
[yt-skip]     seekable: 0.00-6.00  buffered: 0.00-6.00
[yt-skip]  +8175ms  seek accepted on try 16, 3000ms after the first
[yt-skip]  +8200ms  skipped — ad gone 25ms after the seek landed
```

### The guard that matters

The ad and the real video are **the same `<video>` element**. A seek at the wrong
moment fast-forwards the thing you actually wanted to watch, so two conditions must
both hold: the player must be in its `ad-showing` state, and a clickable skip button
must be on screen. `skip()` returns early when no ad is showing, and `seekPastAd()`
re-checks it. That duplication is deliberate — it is the one operation here that can
ruin a viewing.

Both were tested: a simulated stale skip button with no ad running leaves the real
video's `currentTime` untouched.

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
[yt-skip]  +5175ms  SEEK past ad  (latency 175ms, poll is 200ms)
[yt-skip]  +5200ms  skipped — ad gone 25ms after the seek landed
[yt-skip] ad start  #2  "Ad 2 of 2"  (next in pod)
```

Times are relative to the start of that ad. The numbers to read:

- **latency** — the gap between the button becoming clickable and us seeking. This
  is the only delay we control, and it should land between 0 and `POLL_MS`. Measured
  at 4ms, 48ms and 152ms on real ads, so the poll is behaving.
- **which selector matched** — after a few sessions this says whether all three
  class names are live or two are dead weight.
- **seek refused / seek accepted on try N** — whether the ad let us move it, and how
  many tries it took. A long refusal streak is the pod case described above.
- **`unskippable`** — an ad that ran to the end with no button, so nothing to do.

### Why there are two loops

The skipper runs at `POLL_MS` (200ms); the watcher runs at `OBSERVE_MS` (25ms) and
never acts. That gap is the point. If the watcher ran at the same 200ms as the
skipper, every button would appear to become clickable on the very tick we acted on
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

- **Only skippable ads.** Unskippable ones never show the button, which is the
  signal we wait for, so they play in full.
- **youtube.com only.** Videos embedded in other sites are out of scope; the script
  does not run in frames (`all_frames: false`).
- **Not YouTube Kids or music.youtube.com.** Add the host to `matches` if you want them.
