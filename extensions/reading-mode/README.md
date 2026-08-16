# Reading Mode

Turn any article into a clean, distraction-free reading view. Click the toolbar
icon to open it; click again or press **Esc** to close. The only chrome is a
thin bar across the top — the article's name on the left, tools on the right.

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
when you close it. Nothing is stored.

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
overlay and every later one toggles it. Permissions are just `activeTab` +
`scripting` — no broad host access, no storage, nothing phones home.

## Surprises worth knowing

- `reader.css` is fetched by the content script at runtime, which is why it's
  listed under `web_accessible_resources` in the manifest
- `lib/Readability.js` is vendored verbatim from mozilla/readability (Apache
  2.0). To update it, replace the file with the latest from their repo
- `lib/mermaid.min.js` is vendored the same way (MIT, v11.16.1, 3.6 MB —
  `dist/mermaid.min.js` from the `mermaid` npm package). It only loads in the
  diagram tab, never in a page
- Gemini returns the diagram as JSON, not as Mermaid source: model-written
  Mermaid breaks on quotes and brackets in labels, so `diagram.js` generates
  the source itself. `visual-diagram-feature-plan.md` has the reasoning
