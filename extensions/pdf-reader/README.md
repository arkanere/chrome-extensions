# PDF Reader

Opens PDFs in its own viewer and reads them aloud with Kokoro-82M, a neural voice
that runs on your own GPU, highlighting each word as it is spoken. Click any word
to start reading from there.

Nothing is uploaded. Synthesis happens locally, so it works offline and your
documents never leave the browser.

## What it does

- **Replaces Chrome's PDF viewer.** A `.pdf` link — on the web or on disk —
  lands in this viewer instead. Pages render in a scrolling column and the text
  stays selectable, so it works as a plain PDF viewer even if you never press
  play.
- **Reads aloud** with Kokoro-82M running on this machine — nine voices, all of
  which report per-word timing. Chrome's own `(Natural)` voices remain in the
  picker as a fallback.
- **Highlights as it speaks** — the current word in orange, the sentence around
  it in a lighter band — and scrolls to follow, but only when the word has
  actually left the visible area.
- **Click a word to read from there.** Dragging to select text still selects.
- **Remembers** your voice, your speed, and where you stopped in each document.
  Reopening a PDF picks up where you left off.

Controls sit in the header: previous sentence, play/pause, next sentence, a
speed slider (0.6× to 2.5×), a voice picker, and zoom.

## Installing

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder (`extensions/pdf-reader`)
4. Pin it to the toolbar

**For local PDFs**, also switch on **Allow access to file URLs** on the
extension's card. Chrome cannot grant this programmatically, and without it a
`file://` PDF cannot be read. Web PDFs work without it.

## Opening a PDF

Three ways in, because interception is best-effort:

- **Automatically** — any URL ending in `.pdf` redirects to the viewer.
- **The toolbar button** — re-opens the current tab's PDF in the viewer. This is
  what you need for URLs like `site.com/download?id=123`, which Chrome's
  redirect rules cannot recognise as a PDF (they match on the URL, never on
  `Content-Type`). Right-clicking a PDF link does the same.
- **Open a PDF** in the header — a file picker, which also sidesteps the
  file-URL permission above.

## Voices

Nine Kokoro voices are grouped first, and one of them is the default. They run
here, on the GPU, from files inside this folder — so they sound the same on every
machine and they always report per-word timing, which is what the highlight needs.
Run `sh fetch-assets.sh` in the repo root once to install them; see the root
README.

Chrome's own voices stay below them. If the model is missing or will not start,
the reader falls back to `chrome.tts`, says so once, and keeps reading. The picker
still lists only voices that report word timing, since the rest cannot be
highlighted — audio without highlighting beats no audio, so a voice you have
already chosen is never hidden from you.

Kokoro is a synthesiser rather than a player: it hands back finished audio plus a
table of word timings, seconds after being asked. That is why the reader
synthesises three sentences ahead of the one you are hearing, and why it starts
loading the model when the viewer opens rather than when you press play.

## What it will not do

- **Scanned PDFs.** No text layer means nothing to read. The viewer detects this
  and says so rather than offering a play button that does nothing. OCR is a
  different project.
- **Cloud voices.** They return finished audio with no per-word timing, so
  highlighting is impossible. They are hidden from the picker.
- Annotation, form filling, editing, or search.

Two rough edges worth knowing, both from how PDFs store text rather than from
choices made here: running headers and footers can merge into the first sentence
of a page, and footnote markers can be read out mid-sentence.

## How it works

The viewer is an extension page. `background.js` registers a
`declarativeNetRequest` rule redirecting PDF navigations to
`viewer.html?src=<url>`; everything after that happens in the page, because MV3
service workers are shut down when idle and playback state cannot live there.

The pipeline is one direction, and the modules do not import across it:

```
source → parser → document-model → controller → speech adapter → chrome.tts
                        ↓               ↓
                    renderer  ←──  highlighter
```

`core/document-model` is the pivot: it turns pdf.js text items into sentences,
each word carrying its offset into the sentence string *and* its rectangles on
the page. Playback maps the engine's `charIndex` back to a word; highlighting
turns that word's rectangles into pixels; click-to-read runs the same geometry
backwards. It deliberately imports nothing — not pdf.js, not the DOM — which is
what let its sentence splitting be checked against eight real PDFs outside
Chrome.

pdf.js (v6.2.108) is vendored in `lib/`. MV3 blocks remote script, and loading a
renderer from someone else's host would send your documents through it.

**[architecture.md](architecture.md)** has the full design: what was measured
and why, the module boundaries and what each one may not know, every decision
taken and reversed, and a phase-by-phase record of what building it found.

## Permissions

| Permission | Why |
| --- | --- |
| `declarativeNetRequest` | Redirect PDF navigations to the viewer |
| `tts` | Speak. `chrome.tts` is used rather than `speechSynthesis` because it has no user-activation gate |
| `storage` | Remember voice, speed, and per-document position |
| `contextMenus` | The right-click entry on PDF links |
| `*://*/*`, `file://*/*` | Read the PDF's bytes, and let the redirect fire on any host |

No host is contacted other than the one serving the PDF you opened.

## Debugging

The viewer's devtools console exposes a `pdfReader` object:

| Call | What it does |
| --- | --- |
| `pdfReader.sentences()` | Table of every parsed sentence — id, page, word count, text |
| `pdfReader.sentences(12)` | Parse up to page 12 and list only that page |
| `pdfReader.trace = true` | Log every position event as it is spoken |
| `pdfReader.highlight(id, word)` | Paint a sentence without speaking it, to check geometry |
| `pdfReader.voices()` | What this machine actually has |
| `pdfReader.forget()` | Drop this document's saved position |

There is no test suite and no build step — plain ES modules, loaded unpacked.
Each phase was verified by hand in Chrome against the exit criteria recorded in
`architecture.md`. Two modules (`core/document-model` and `player/controller`)
import nothing and can be exercised in plain node; that is how the sentence
splitting and the word mapping were checked before Chrome ever ran them, and it
is worth keeping.
