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
