# chrome-extensions

Chrome extensions I built because I wanted them. Each one lives in its own folder
under `extensions/` and is loaded separately — Chrome has no concept of a "bundle",
so every extension is installed on its own.

## Extensions

| Extension | What it does |
| --- | --- |
| [`time-check`](extensions/time-check) | Daily time budgets per site, with escalating nags once you're over |
| [`reading-mode`](extensions/reading-mode) | One-click distraction-free reading view for any article — reads aloud in a neural voice, highlights, defines words, and diagrams the whole thing |
| [`pdf-reader`](extensions/pdf-reader) | Opens PDFs in its own viewer and reads them aloud with Kokoro-82M running on this machine, highlighting each word |
| [`epub-reader`](extensions/epub-reader) | The same, for EPUBs: opens a book in its own viewer and reads it aloud with Kokoro-82M running on this machine, highlighting each word |
| [`my-x`](extensions/my-x) | Tag X accounts with your own labels and drop them out of the For You feed, a whole tag at a time |

## Installing any of them

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the extension's folder — `extensions/<name>`,
   the one containing `manifest.json`, *not* this repo root
4. Pin it to the toolbar

Repeat per extension. After changing code, hit the circular **reload** arrow on that
extension's card. Reloading picks up changes to the service worker and popup
immediately; open tabs need a refresh to pick up a new content script.

## The voice

The three readers speak with **Kokoro-82M**, an 82-million-parameter text-to-speech
model that runs on your GPU, on this machine. Nothing spoken leaves it. It is a
better voice than Chrome ships, it sounds the same on every machine, and — the
reason it was worth the trouble — it reports the timing of every word, so the
highlight is exact rather than dependent on which voices your OS happens to have.

The model is 326 MB and is not in git. Before loading any of the three readers:

```
sh fetch-assets.sh
```

That downloads both sets of weights, nine voices and onnxruntime's WebAssembly (~460 MB) once
into `.assets-cache/`, then **hardlinks** them into each of the three extension
folders. Hardlinks are what let this respect the self-containment rule below
without paying for it three times: each folder holds real files, but the bytes are
stored once. Re-run it any time; anything already in place is skipped.

Without it the readers still work — they fall back to `chrome.tts` and say so.

Three things are vendored into each reader's `lib/` to make this run offline:
[HeadTTS](https://github.com/met4citizen/HeadTTS) (MIT, the phonemiser and the TTS
worker), [transformers.js](https://github.com/huggingface/transformers.js)
(Apache 2.0, model loading and ONNX inference) and onnxruntime-web. The first
carries its licence in every file; the second's is in
`lib/transformers/TRANSFORMERS-LICENSE`.

`transformers.min.js` is vendored **patched**, by `patch-transformers.sh` at the
repo root. Run it once whenever you replace the bundle; it is idempotent and
refuses to guess if the code it edits has moved. Without it the voice cannot start
at all in an extension: onnxruntime loads its backend by wrapping the factory in a
Blob and calling `import(blob:…)`, MV3's `script-src 'self'` blocks that, and both
backends fail with *"no available backend found … Failed to fetch dynamically
imported module: blob:chrome-extension://…"*. Widening the policy is not an option
— Chrome rejects the manifest outright with *"Insecure CSP value 'blob:'"*. So the
two places that reach for a blob are switched off, leaving the direct same-origin
import that `'self'` does allow. Measured: fails every time with the blob path,
loads on WebGPU in ~8s without it.

This is the one part of markdown-reader's setup a Chrome extension cannot copy: a
webview CSP may contain `blob:`, and its does, so it never meets this.

HeadTTS is vendored with **two deliberate changes**, both marked `LOCAL CHANGE`.

`lib/headtts/headtts.mjs` — the connect timeout. Upstream allows 30s for the first
message and then only 10s after each progress report. Progress reports arrive
almost immediately for the small config and tokenizer files, which resets the
budget to 10s — and then there is a long silence while the 321MB model is opened
and read, measured at ~20s, before a single byte of its progress is reported.
Upstream's budget expires inside that gap, `connect()` rejects with "Connection
timed out.", and `speech/dual.js` quietly retires Kokoro and reads on with a
system voice. markdown-reader never hit this because it stages every asset as a
blob before the worker starts, so there is no gap to fall into.

There are **two** sets of weights, and both are needed. `model.onnx` (fp32, 310 MB)
is what WebGPU uses. `model_quantized.onnx` (q8, 88 MB) is what the wasm fallback
uses when WebGPU is unavailable — and it is not optional: transformers asks for
the quantised build *by name*, and a missing file is a 404 that throws, taking the
whole voice down to `chrome.tts`. Whatever `dtypeWasm` names in
`speech/kokoro-adapter.js` must be a file `fetch-assets.sh` actually fetches.
markdown-reader names `q4` and never downloads it; its wasm fallback has never
been exercised.

`lib/headtts/worker-tts.mjs` — the worker's `connect()` is async and is called
from its message handler with no `catch`, so anything that throws in it becomes
an unhandled rejection and the worker simply goes quiet. HeadTTS waits for a
`ready` that never comes. Measured: a failed tokenizer load hung for over three
minutes with nothing in the console. The added handler rethrows the rejection as
an uncaught exception, which is what `worker.onerror` needs to see in order to
reject the connect promise with the real reason.

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
`epub-reader`, `reading-mode` — and the same eleven files and folders carry it each
time. How much of each is a genuine copy varies, and it is worth knowing which is
which before editing one:

```
                         pdf   epub  reading   what it is
speech/adapter.js         ==    ==     ==      the chrome.tts interface
speech/kokoro-adapter.js  ==    ==     ==      the same interface, over Kokoro
speech/dual.js            ==    ==     ==      both of the above as one engine
view/controls.js          ==    ==     ==      play/pause, skip, speed, voice
player/controller.js       ~    ==     ==      the queue and the current position
core/document-model.js     ~    ==     ==      runs become words and sentences
core/text-walk.js          –    ==     ==      rendered DOM becomes text runs
lib/headtts/              ==    ==     ==      vendored: phonemiser and TTS worker
lib/transformers/         ==    ==     ==      vendored: transformers.js, pinned local
view/highlighter.js        ≠     ~      ~      paints the word being spoken
store/settings.js          ~     ~      ~      prefs, and where you stopped

  ==  byte-identical            ~  same file, small deliberate divergence
   –  not needed there          ≠  a different implementation entirely
```

The six `==` rows across all three are the real shared code. Two of them are
vendored libraries nobody should be hand-editing at all. The next rows are
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
build step nobody wants. But the threshold was written down — **the next time one
of the `==` files needs the same edit three times, build the copy step instead** —
and adding Kokoro is the change that met it. `view/controls.js` took one identical
edit in all three, and three more `==` rows arrived with it.

So the copy step is now owed. `fetch-assets.sh` is the obvious place to hang it:
it already walks the three folders placing files, and the `==` rows are the same
kind of thing — one source, three destinations. Until that is built, an edit to a
`==` file is an edit to three files, and `cmp` is what says you got it right:

```
for f in speech/adapter.js speech/kokoro-adapter.js speech/dual.js view/controls.js; do
  cmp extensions/epub-reader/$f extensions/pdf-reader/$f &&
  cmp extensions/epub-reader/$f extensions/reading-mode/$f
done
```

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
