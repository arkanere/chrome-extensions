# Reading Mode

Turn any article into a clean, distraction-free reading view. Click the toolbar
icon to open it; click again to close. The only chrome is a thin bar across the
top — the article's name on the left, tools on the right.

**Esc** unwinds one layer at a time: an open dictionary card first, then the
voice if it is reading aloud, then the reader itself.

## What it does

- Extracts the main article from the page using Mozilla's
  [Readability.js](https://github.com/mozilla/readability) (the library behind
  Firefox Reader Mode), vendored in `lib/`
- Renders it as a full-screen overlay: serif type at a comfortable size, a
  ~66-character measure, warm off-white paper — or a warm dark theme, following
  your system's light/dark preference automatically
- Keeps the article's images, quotes, code blocks, and tables, styled to match
- Leaves the page untouched: extraction runs on a clone of the DOM, and the
  overlay lives in a shadow root so site CSS can't bleed in. Closing restores
  the page exactly as it was — no reload, scroll position preserved

If a page has no extractable article (a homepage, a web app), it shows a brief
notice instead.

## Highlights

Select any text in the reader and a small **Highlight** pill appears — click it
to mark the passage. A chip in the bottom-right corner counts your highlights;
clicking it copies them all to the clipboard as plain text (one passage per
paragraph), ready to paste anywhere. Click a highlight to remove it.

Highlights are session-only: they live while the overlay is open and vanish
when you close it.

## Read aloud

The top bar's **Read aloud** button has the article read to you, lighting up the
word being spoken and the sentence around it as it goes. `↑` and `↓` step back
and forward a sentence, the slider sets the speed, and the picker chooses the
voice. Click any word in the article to start reading from there — dragging to
select still selects, so the two gestures don't collide.

Pause is stop-and-remember: pausing, seeking, or changing the voice or speed all
drop the current utterance and re-speak the sentence from its start, so there is
no half-spoken sentence to be confused by. **Esc** stops the voice before it
closes the reader.

Speech uses Kokoro-82M, a neural voice running on your own GPU. Its nine voices
are grouped first in the picker and one of them is the default; they sound the
same on every machine and all report per-word timing, which is what the highlight
needs. Run `sh fetch-assets.sh` in the repo root once to install the model — see
the root README. Chrome's own `chrome.tts` voices stay below them, and the reader
falls back to those if the model is missing or will not start.

The picker lists only voices that report word timing, since the word highlight is
half the point. Everything synthesises locally either way, so nothing about
reading aloud leaves the browser. If a voice you saved is no longer available, the
best remaining one is used instead and the console says so.

Your voice, your speed, and where you stopped in each article are remembered —
see *What is stored* below. This is the same feature, with the same controls,
as in the sibling `pdf-reader` and `epub-reader` extensions.

## Define

The same selection pill has a **Define** button for words and short phrases
(up to ~8 words). It opens a small card next to your selection: single words
get dictionary definitions with phonetics and part of speech from
[dictionaryapi.dev](https://dictionaryapi.dev); phrases and names fall back to
a Wikipedia summary with a link to the full article. Esc or clicking anywhere
else dismisses the card (a second Esc closes the reader).

**Gemini (optional).** Copy `config.example.js` to `config.js` and add a
[Google AI Studio](https://aistudio.google.com/apikey) free-tier key, and
Define uses Gemini instead: it sends the term *plus its surrounding paragraph*
and gets back a context-aware explanation — much better for phrases, idioms,
and jargon than a dictionary. `config.js` is gitignored; never commit a key.
If the key is missing or the request fails, it falls back to the free lookups
above automatically.

## Create visual diagram

The top bar's **Create visual diagram** button turns the whole article into a
mind map or flow diagram. It sends the article text to Gemini, which returns
its structure as a graph; the graph is drawn with
[Mermaid](https://mermaid.js.org) in a new tab, where you can drag to pan and
scroll to zoom. The model picks the shape: a mind map for articles that explain
a topic, a flow diagram for ones that describe a process, a sequence, or an
argument.

The tab never shows the whole graph at once — a 35-node diagram is unreadable.
It opens on the centre and its top-level branches, and clicking any node
replaces the view with that node and the level below it. The breadcrumb in the
top bar shows where you are and jumps back to any level; Back and Esc step up
one. Nodes with nothing below them are not clickable.

**Show all** puts the whole diagram on screen at once, for when you want to see
how the parts sit together rather than read one branch. It is cramped on a big
graph — that is what the focus view exists to avoid — so clicking any node in
it drops you back into the focus view at that node.

Generating takes a few seconds and the button says "Generating…" while it
works — the tab opens only once the diagram is ready, so a failure shows up as
a notice in the reader rather than an empty tab. The button only appears when a
Gemini key is configured (see Define above); unlike Define there is no free
fallback.
Long articles are truncated to the first ~40,000 characters.

Diagrams are session-only, like highlights: they live in
`chrome.storage.session` and are gone when you quit the browser.

## What is stored

Read aloud is the first thing Reading Mode keeps. In `chrome.storage.local`, on
your machine only:

- your chosen voice and speed, one setting for the whole extension
- where you stopped reading each article — its URL, its title, and a character
  offset into its text. The last 200 articles are kept; older ones are dropped.
  Reaching the end of an article forgets its position

Everything else is still session-only: highlights vanish with the overlay, and
diagrams live in `chrome.storage.session` until you quit the browser.

## What leaves the browser

Define sends the selected term to `api.dictionaryapi.dev` and/or
`en.wikipedia.org`, or (with a key configured) the term and its surrounding
paragraph to `generativelanguage.googleapis.com`. Create visual diagram sends
the article's text to the same Gemini host. Those are the hosts listed under
`host_permissions`; nothing else leaves the browser. Both run in the service
worker so page CSP can't block them.

## How it works

Nothing runs until you click the icon. `background.js` injects
`lib/Readability.js` + `content.js` into the active tab on each click; the
content script guards with a window flag, so the first injection opens the
overlay and every later one toggles it. Permissions are `activeTab`,
`scripting`, `storage` and `tts` — no broad host access beyond the three lookup
hosts above, and nothing phones home.

Read aloud is split across the two, and now across a third place as well.
`chrome.tts` is not available to content scripts, so the service worker does that
speaking and the reader drives it over a long-lived port. No playback state lives
in the worker — MV3 suspends it after ~30s idle — so it is a speaker, not a
player. `tts-plan.md` has the reasoning.

Kokoro cannot run in the content script either, for a different reason: compiling
WebAssembly and starting a module Worker are both checked against the CSP of
whatever site you are on, so the voice would work on a blog and fail on GitHub.
So `tts-frame.html` is injected as a hidden iframe. It is an extension page, so it
carries this extension's CSP and gets WebAssembly, module Workers, WebGPU and Web
Audio everywhere. The audio plays there; only the word events come back, and the
highlighting stays in `content.js` where the article's text nodes are. One model
per tab, so two tabs can read at once.

The modules under `speech/`, `player/`, `core/`, `view/` and `store/` are copied
from `epub-reader`, which is the repo's rule for shared code.

## Surprises worth knowing

- **The voice frame needs `allow="autoplay"`.** User activation is per-frame, so
  the click on Read aloud activates the article page and not `tts-frame.html`.
  Without the delegation the frame's `AudioContext` stays suspended — and the
  failure hides itself, because the word events are timers: the highlight marches
  happily through a sentence nobody can hear.
- The frame talks over a `MessagePort`, not `window.postMessage`. The article page
  shares this DOM and can post into the frame; it cannot reach the port.
- `reader.css` is fetched by the content script at runtime, which is why it's
  listed under `web_accessible_resources` in the manifest. So are the read-aloud
  modules: `content.js` is injected as a classic script and cannot use `import`
  statements, so it pulls them in with dynamic `import()` at runtime
- the `::highlight()` rules for the spoken word live in `reader.css` and nowhere
  else. `CSS.highlights` is a global registry, but `::highlight()` *styling*
  resolves against the tree the range is in — and every range painted is inside
  the reader's shadow root, which is where `reader.css` is injected
- adding or removing an in-page highlight splits or merges the article's text
  nodes, which silently invalidates every word the speech model is holding. The
  model is re-walked and rebound after each, and the failure it prevents is
  invisible rather than loud
- `lib/Readability.js` is vendored verbatim from mozilla/readability (Apache
  2.0). To update it, replace the file with the latest from their repo
- `lib/mermaid.min.js` is vendored the same way (MIT, v11.16.1, 3.6 MB —
  `dist/mermaid.min.js` from the `mermaid` npm package). It only loads in the
  diagram tab, never in a page
- Gemini returns the diagram as JSON, not as Mermaid source: model-written
  Mermaid breaks on quotes and brackets in labels, so `diagram.js` generates
  the source itself. `visual-diagram-feature-plan.md` has the reasoning
