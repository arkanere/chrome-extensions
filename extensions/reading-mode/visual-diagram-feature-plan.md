# Visual diagram — feature plan

Turn the article you are reading into a mind map or flow diagram in one click.
Define explains a word; this explains the whole piece.

## Shape of it

The reader gains a sticky **top bar** with a **Create visual diagram** button.
Clicking it sends the article's plain text to Gemini, which returns a graph as
structured JSON. The graph is stashed in `chrome.storage.session` and a new tab
opens on `diagram.html`, which turns the graph into Mermaid source and renders
it. Pan with a drag, zoom with the wheel.

## Decisions

**Its own tab, not a panel in the reader.** No iframe, so a page's `frame-src`
CSP can never block it, and Mermaid runs under the extension's own CSP with no
site styles to fight.

**The wait happens in the reader.** The button reads "Generating…" for the 3–10
seconds the model takes, and the tab opens only when the diagram is ready.
Failures surface as a toast where you clicked, and you never get a blank tab.

**Mermaid is vendored** (`lib/mermaid.min.js`, v11.16.1, 3.6 MB) the same way
`lib/Readability.js` is. It has no `eval`, no `new Function`, no dynamic
`import()`, and makes no network calls at runtime — a plain global bundle that
is MV3-CSP-safe and needs no build step. To update it, replace the file with
`dist/mermaid.min.js` from a newer `mermaid` npm tarball.

**Gemini returns JSON, not Mermaid.** LLM-written Mermaid breaks constantly on
unescaped quotes and parentheses in labels, and one parse error means a blank
page. Instead the request carries a `responseSchema` and comes back as
`{ type, title, nodes[], edges[] }`; `diagram.js` generates the Mermaid source
itself, so the escaping is ours to get right once. The schema also pins the
model to one shape instead of free-form prose.

**`gemini-flash-latest`, not flash-lite.** Flash-lite stays behind Define — it
is fine for one word, not for structuring an article.

**The button is hidden without a key.** Unlike Define there is no free
fallback, and a dead button is worse than no button.

## Retired promise

The README used to say "zero on-screen UI — the overlay is the article and
nothing else". The top bar ends that, matching how `pdf-reader` and
`epub-reader` present their controls.

## Pipeline

1. `content.js` — `setupTopBar()` builds the bar from the Readability result it
   already has, and sends `{ type: "rm-diagram", title, text }`.
2. `background.js` — `geminiDiagram()` truncates to 40k chars, calls Gemini
   with the schema, then `cleanGraph()` validates: unique ids, ≤40 nodes,
   dangling edges dropped, parent cycles broken. A schema-conforming response
   can still be an unrenderable graph, so nothing reaches the tab unvalidated.
3. `background.js` — stores the graph under a random id in
   `chrome.storage.session` (the service worker can be killed between steps, so
   a variable would not survive) and opens `diagram.html?id=…`.
4. `diagram.js` — reads the graph, sanitizes every label once, emits
   `flowchart TD` or `mindmap`, renders, wires pan/zoom.

Session entries are a few KB and die with the browser, so there is no cleanup
step — and not deleting on read means reloading the diagram tab still works.

## Surprises worth knowing

- Mermaid's `mindmap` grammar is indentation-based with no id references, so
  `diagram.js` walks `parent` pointers depth-first at two spaces per level.
  Quoted labels survive parentheses and other punctuation (checked), but a
  label that does break the parser falls back to rendering the same graph as a
  `flowchart TD` — built from the `parent` pointers, so the hierarchy survives
  the fallback.
- The two diagram types get **different Mermaid configs**, checked in Chrome
  both ways. Flowchart uses `htmlLabels: false`, so labels are real SVG text a
  canvas could rasterize if export is ever added. Mindmap needs
  `htmlLabels: true` — with it off, Mermaid mis-measures the label and the text
  spills outside the node box. Mindmap also ignores `primaryColor` and tints
  each branch from the `cScale*` palette, so the warm tones have to be set
  there or the diagram comes out in Mermaid's default purple and blue.
- `storage` is the only permission this feature adds. `chrome.tabs.create`
  needs no `tabs` permission, and a top-level `chrome-extension://` tab needs
  no `web_accessible_resources` entry.

## Not in v1

Export (SVG download, copy PNG) and a mindmap/flowchart toggle that re-asks the
model. The model picks the type; the tab renders and nothing else.
