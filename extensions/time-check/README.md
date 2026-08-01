# Time Check

Give each time-sink site a daily budget. Get pinged as you burn through it, and
nagged every 5 minutes once you blow past it — like hitting snooze on an alarm.

## How it works

- **Only counts time you're actually there.** A tab is on the clock when it's the
  active tab in the focused Chrome window — and either a video/audio element is
  playing, or you've used the keyboard or mouse in the last 5 minutes. So a video
  you're watching without touching anything counts, but a paused tab you walked
  away from doesn't. A background tab never counts.
- **Quarter-mark pings.** On a 60 minute budget you get a notification at 15, 30 and
  45 minutes, telling you how much is left.
- **Then it nags.** At 60 minutes and every 5 minutes after, you get a notification,
  a banner on the page, and the page dims. "Snooze 5 min" clears both until the next ping.
- **Budgets are per calendar day**, local time. There is no way to reset a day's
  number — see below.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick this folder (`extensions/time-check`)
4. Pin the clock icon to the toolbar so you can see today's numbers at a glance

The first time a notification fires, macOS may ask whether to allow notifications
from Chrome. If you never see one, check System Settings → Notifications → Chrome,
and make sure a Focus mode isn't silencing it. The on-page banner works either way.

## Use

Click the toolbar icon. It shows today's usage for every budgeted site, lets you
change a budget inline, remove a site, or add a new one. `youtube.com` at 60 minutes
is set up by default.

A budget on `youtube.com` also covers its subdomains, like `m.youtube.com`.

## Time data is append-only

The whole point of this thing is that the number is true, so there is deliberately
no way to reset, zero, or edit it — not in the popup, not anywhere. A counter you can
clear is a counter you *will* clear at the exact moment it's telling you something
you'd rather not hear.

A finished stretch of attention is written once as a segment and never touched again:

```
log:2026-08-01 = [ { d: "youtube.com", s: 1754049600000, e: 1754050213000 }, ... ]
```

One storage key per day, so recording today never rewrites history. A stretch that
crosses midnight is split at the boundary, so each day's total is a plain sum of its
own key — no segment is ever counted twice or lost.

The single exception is **retention: whole days are dropped once they pass 180 days**
(`KEEP_DAYS` in `background.js`). That's a policy fixed in advance, not something you
can reach for in a weak moment — and it only ever removes entire aged-out days, never
a partial edit and never today.

If you genuinely need to intervene, it's a console command, not a button — go to
`chrome://extensions` → **service worker** → Console. You have to mean it.

## Notes

Manifest V3 shuts the service worker down when it's idle, so there's no live timer.
The current stretch lives in storage as `{ domain, start, lastSeen }` and gets a
heartbeat on every tab switch, focus change, playback change, and 1-minute alarm.
It's closed into a segment only when the site actually changes — otherwise a day
would be 1,440 one-minute fragments.

Because it's all timestamps, a dead worker loses nothing. A heartbeat gap longer
than 150 seconds means the machine slept rather than that you were browsing, so the
segment closes at the last heartbeat instead of crediting the gap. Totals are
accurate to about ±1 minute and pings can land a few seconds late.

Everything is stored locally in `chrome.storage.local`. Nothing leaves your machine.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Permissions and entry points |
| `background.js` | Service worker: tracking, alarms, nag logic, notifications |
| `content.js` | On-page banner and dim overlay (in a shadow root) |
| `popup.html` / `popup.js` | Toolbar UI: today's usage, add/edit/remove sites |
