# chrome-extensions

Chrome extensions I built because I wanted them. Each one lives in its own folder
under `extensions/` and is loaded separately — Chrome has no concept of a "bundle",
so every extension is installed on its own.

## Extensions

| Extension | What it does |
| --- | --- |
| [`time-check`](extensions/time-check) | Daily time budgets per site, with escalating nags once you're over |
| [`reading-mode`](extensions/reading-mode) | One-click distraction-free reading view for any article, light/dark, zero UI |

## Installing any of them

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the extension's folder — `extensions/<name>`,
   the one containing `manifest.json`, *not* this repo root
4. Pin it to the toolbar

Repeat per extension. After changing code, hit the circular **reload** arrow on that
extension's card. Reloading picks up changes to the service worker and popup
immediately; open tabs need a refresh to pick up a new content script.

## Layout

```
extensions/
  <name>/
    manifest.json     required, and must sit at the folder root
    README.md         what it does, how it works, anything surprising
    icons/            16 / 32 / 48 / 128 px PNGs
    ...               background.js, popup.html, content.js as needed
```

One rule worth keeping: **an extension folder must be self-contained.** Chrome packs
the folder you point it at, so nothing can reach outside it — no shared `../lib`
directory. If two extensions ever need the same code, copy it. Duplication is the
cheaper problem here.

## Starting a new one

Copy the closest existing extension, then in the new folder:

- Change `name`, `description`, and reset `version` to `1.0.0` in `manifest.json`
- Trim `permissions` down to what you actually use — Chrome warns the user about
  each one, and unused entries are pure cost
- Replace `icons/`
- Rewrite the README
- Add a row to the table above

Everything is Manifest V3. Worth knowing going in: the service worker is shut down
when idle, so nothing can hold state in a module-level variable or run a live timer.
Persist state in `chrome.storage`, wake up on events, and use `chrome.alarms` for
anything periodic.
