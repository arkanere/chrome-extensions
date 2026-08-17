# chrome-extensions

Chrome extensions I built because I wanted them. Each one lives in its own folder
under `extensions/` and is loaded separately — Chrome has no concept of a "bundle",
so every extension is installed on its own.

## Extensions

| Extension | What it does |
| --- | --- |
| [`time-check`](extensions/time-check) | Daily time budgets per site, with escalating nags once you're over |
| [`reading-mode`](extensions/reading-mode) | One-click distraction-free reading view for any article — reads aloud, highlights, defines words, and diagrams the whole thing |
| [`pdf-reader`](extensions/pdf-reader) | Opens PDFs in its own viewer and reads them aloud with Chrome's local neural voices, highlighting each word |
| [`epub-reader`](extensions/epub-reader) | The same, for EPUBs: opens them in its own viewer and reads them aloud, word by word |
| [`youtube-extension`](extensions/youtube-extension) | Ends a YouTube ad the moment it becomes skippable, so it is on screen as briefly as possible |

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

**Where that rule now stands.** Read aloud exists three times over — `pdf-reader`,
`epub-reader`, `reading-mode` — and the same seven files carry it each time. How
much of each is a genuine copy varies, and it is worth knowing which is which
before editing one:

```
                         pdf   epub  reading   what it is
speech/adapter.js         ==    ==     ==      the chrome.tts interface
view/controls.js          ==    ==     ==      play/pause, skip, speed, voice
player/controller.js       ~    ==     ==      the queue and the current position
core/document-model.js     ~    ==     ==      runs become words and sentences
core/text-walk.js          –    ==     ==      rendered DOM becomes text runs
view/highlighter.js        ≠     ~      ~      paints the word being spoken
store/settings.js          ~     ~      ~      prefs, and where you stopped

  ==  byte-identical            ~  same file, small deliberate divergence
   –  not needed there          ≠  a different implementation entirely
```

The two `==` rows across all three are the real shared code. The next three are
identical between the two HTML readers and differ in `pdf-reader`, which has no
DOM to walk and pages where the others have sections. `view/highlighter.js`
splits three ways: `pdf-reader` positions its own boxes over glyph geometry,
while the other two hand a `Range` to the CSS Custom Highlight API and let the
browser paint it. So does `store/settings.js` — `pdf-reader` remembers a
sentence id, the other two a character offset, and each keys it differently
because a PDF, a book and a web page are not identified the same way (bytes,
bytes, and a URL).

Copying is still the right call: a `shared/` folder would have to be copied into
each extension at build time anyway, trading a rule everyone understands for a
build step nobody wants. But the threshold is now written down — **the next time
one of the `==` files needs the same edit three times, build the copy step
instead.** Until then, an edit to one of them is an edit to three files, and
`cmp` is what says you got it right.

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
