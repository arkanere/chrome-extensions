# EPUB Reader

Opens EPUBs in its own viewer and reads them aloud with Kokoro-82M, a neural voice
that runs on your own GPU, highlighting each word as it is spoken. Click any word
to start reading from there.

Nothing is uploaded. Synthesis happens locally, so it works offline and your books
never leave the browser.

This is [`pdf-reader`](../pdf-reader) with a different front half. Same header,
same controls, same click-a-word gesture — someone who uses both should not have
to learn a second interface.

## What it does

- **Opens any DRM-free EPUB**, from a file on disk or a link on the web. Chapters
  render in one scrolling column and the text stays selectable, so it works as a
  plain book reader even if you never press play.
- **Reads aloud** with Kokoro-82M running on this machine — nine voices, all of
  which report per-word timing. Chrome's own `(Natural)` voices remain in the
  picker as a fallback.
- **Highlights as it speaks** — the current word in orange, the sentence around
  it in a lighter band — and scrolls to follow, but only when the word has
  actually left the visible area.
- **Click a word to read from there.** Dragging to select text still selects.
- **Remembers** your voice, your speed, and where you stopped in each book.
  Reopening a book picks up where you left off.

Controls sit in the header: **Read aloud** / **Pause**, a speed slider (0.6× to
2.5×), a voice picker, and two buttons that step the reading font size where
pdf-reader has zoom.

## Installing

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this folder (`extensions/epub-reader`)
4. Pin it to the toolbar

**For books opened from a `file://` URL**, also switch on **Allow access to file
URLs** on the extension's card. Note that this path is not confirmed working —
see below. The file picker and drag-and-drop need no permission at all and are
the reliable way in.

## Opening a book

Unlike PDFs, Chrome **downloads** an `.epub` rather than navigating to it, so the
file picker is the primary way in here and interception is a bonus:

- **Open a book** in the header — a file picker.
- **Drag and drop** an EPUB anywhere on the viewer page. Because a book usually
  arrives as a download, this is the common case and is treated as a first-class
  entry point rather than a nicety.
- **The toolbar button**, or right-click → **Open in EPUB Reader**, re-opens
  whatever the current tab is showing.
- **Automatically** — a `declarativeNetRequest` rule redirects URLs ending in
  `.epub` to the viewer. Whether Chrome ever lets this fire, given that it
  prefers to download the file, is still an open question (section 10, question 3
  of the design doc). Do not rely on it.

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

- **DRM'd books.** Adobe ADEPT and Kindle formats cannot be opened, and no design
  changes that. The viewer detects an encrypted content document and says so
  rather than half-opening the book. Font obfuscation — which also ships an
  `encryption.xml` and is common in commercial EPUBs — is *not* DRM and opens
  normally; the obfuscated font simply fails to load and the reader uses its own.
- **Pagination.** A scrolling column, deliberately.
- **A table of contents.** The book ships a nav document, so the data is free,
  but a sidebar is the first thing that would make this look unlike pdf-reader.
- **Cloud voices.** They return finished audio with no per-word timing, so
  highlighting is impossible. They are hidden from the picker.
- **EPUB 3 Media Overlays** (SMIL narration) — a different feature, which would
  replace our TTS rather than use it.
- Bookmarks, notes, search, or library management.

## How it works

The viewer is an extension page. `background.js` registers the redirect rule and
the context menu; everything after that happens in the page, because MV3 service
workers are shut down when idle and playback state cannot live there.

The pipeline is one direction, and the modules do not import across it:

```
source → epub → renderer → text-walk → document-model → controller → speech adapter
                    ↑                                        ↓              ↓
                    └───────────  highlighter  ←─────────────┘    Kokoro / chrome.tts
```

The arrow that does not exist in pdf-reader is the one back up to the renderer:
**an EPUB's text is whatever the browser rendered.** A chapter is XHTML with the
book's own CSS, so what a paragraph actually contains — and where its words fall —
is not knowable until it is on screen. So `view/renderer` draws a chapter,
`core/text-walk` turns the rendered DOM into text runs, and `core/document-model`
receives runs exactly as pdf-reader's receives pdf.js text items. The model still
imports nothing and never learns a DOM was involved, which is what let its
sentence splitting be checked against 113 real books outside Chrome.

Three things carry most of the weight:

- **Each chapter gets its own shadow root.** A book ships CSS written to control
  a whole page — rules for `body`, `h1`, sometimes `*`. Dropped into our document
  that would restyle the header and the controls. A shadow root scopes it, so the
  book's rules cannot reach out and ours cannot reach in.
- **Chapters render lazily and are torn back down** once well outside the
  viewport. Across the test corpus the longest spine is 224 chapters and the
  heaviest book is 14 MB of XHTML, none of which may be parsed on open. A chapter
  that comes back is rebuilt from new text nodes, so the model rebinds its words
  to them and the highlight is redrawn.
- **The highlight is painted by the browser**, via the CSS Custom Highlight API,
  from a `Range` over the real text nodes. The book's markup is never touched,
  and because the paint follows reflow, changing the font size mid-sentence needs
  no redraw at all.

The ZIP is read by hand — no library. All 113 test books use only stored and
deflate, none is zip64, and `DecompressionStream('deflate-raw')` is built into
Chrome. `pdf-reader` vendors pdf.js; this vendors nothing but the voice.

**[planned-architecture.md](planned-architecture.md)** has the full design: the
113-book survey and what it found, the module boundaries and what each one may
not know, every decision taken and reversed, and a phase-by-phase record of what
building it found.

## Permissions

| Permission | Why |
| --- | --- |
| `declarativeNetRequest` | Redirect `.epub` navigations to the viewer |
| `tts` | Speak. `chrome.tts` is used rather than `speechSynthesis` because it has no user-activation gate |
| `storage` | Remember voice, speed, and per-book position |
| `contextMenus` | The right-click entry on EPUB links |
| `*://*/*`, `file://*/*` | Read the book's bytes, and let the redirect fire on any host |

This extension contacts no host other than the one serving the book you opened.
A chapter's images, fonts and stylesheets are resolved out of the ZIP and become
`blob:` URLs. The exception is a book that hardcodes an absolute `http(s)` URL for
a resource: that is left as the book wrote it, and the browser fetches it as it
would on any page.

## Debugging

The viewer's devtools console exposes an `epubReader` object:

| Call | What it does |
| --- | --- |
| `epubReader.spine()` | Table of the reading order — index, path, media type, bytes, and whether the file is actually in the archive |
| `epubReader.sentences(n)` | Chapter `n`'s sentences, rendering and walking it first if needed, plus its median and longest word counts |
| `epubReader.render(n)` | Force a chapter to render without scrolling to it |
| `epubReader.highlight(id, word)` | Paint a sentence without speaking it |
| `epubReader.trace = true` | Log every position event as it is spoken |
| `epubReader.voices()` | What this machine actually has |
| `epubReader.forget()` | Drop this book's saved position |
| `epubReader.play()` / `.pause()` / `.toggle()` / `.seek(id)` | Drive playback from the console |

If the neural voice fails, the reason is logged as
`[epub-reader] neural voice unavailable: …` and kept in `__kokoroError` so it can
be read back after the notice is dismissed. A healthy start logs
`[kokoro] ready in NNNNms on webgpu`.

Positions are keyed by the SHA-256 of the book's bytes rather than by its URL or
filename, so a book that moved on disk still finds its place. What is stored is a
chapter index plus a character offset into that chapter — not a sentence id,
which would silently shift if the sentence splitter ever changed.

There is no test suite and no build step — plain ES modules, loaded unpacked.
Each phase was verified by hand in Chrome against the exit criteria recorded in
the design doc. Two modules (`core/epub.js` and `core/document-model.js`) import
nothing and can be exercised in plain node; that is how the ZIP reader and the
sentence splitting were checked across all 113 books before Chrome ever ran them,
and it is worth keeping.

## Known rough edges

- A book opened from a `file://` path failed to read on the machine this was
  built on, even with **Allow access to file URLs** switched on. Use the file
  picker or drag-and-drop until that is understood.
- Whether a chapter boundary is audible as a gap has not been listened for
  specifically. Text is prefetched one chapter ahead; if a gap is ever heard, the
  fix is to widen that.
- The design doc is still named `planned-architecture.md`. It is a complete
  record, not a plan — every phase is built — but it keeps that name until the
  by-hand listening pass it asks for at the top has been done.
