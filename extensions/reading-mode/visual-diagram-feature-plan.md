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

---

# Focus view — planned, not built

Testing the first real article (`seangoedecke.com/good-api-design`, 35 nodes)
showed the diagram renders correctly and reads badly. Edges pass under node
boxes, boxes touch, and every leaf is a 6–9 word label wrapping to three lines.
Mermaid's mindmap layout places nodes radially and does no edge-node collision
avoidance — it cannot know the labels are this long. The whole graph at once is
the wrong default.

The fix is not layout tuning. It is showing less.

## The rule

**The view shows the focus node and one level below it. Nothing else.**

That one sentence covers both behaviours:

- Focus starts at the root, so the tab opens on the centre plus its L1
  branches — the high-level view, by default and without a button.
- Clicking a visible node moves focus to it. Its children appear, its siblings
  and their subtrees go away.
- Back steps focus to the parent, one level per press. At the root, back does
  nothing.

Focus nests: click down as far as the graph goes.

**Why one level and not the whole subtree.** For a three-level graph the two
are identical, and the article above is three levels — so this costs nothing
today. On a deeper graph "focus + subtree" reintroduces the crowding this
feature exists to remove, while "focus + one level" stays readable at any
depth. Uniform beats special-cased.

## Re-render, don't hide

Hiding nodes in the rendered SVG (`display: none`) is the obvious approach and
the wrong one. Mermaid emits static SVG with baked-in coordinates, so hidden
nodes leave holes and the survivors keep positions computed for a graph that is
no longer on screen. The L1 view suffers most: branch nodes stranded at the
radius that the now-hidden leaves pushed them to.

Instead, filter the graph and render it again. `flowchartSource()` and
`mindmapSource()` already take a graph and return source, so a focus change is:
build the subset, regenerate, `mermaid.render`, re-fit. Layout comes out tight
and correct every time. One render is 100–300 ms at this size.

Generating Mermaid locally instead of asking the model for it — decided above
for escaping reasons — is what makes this cheap. Re-asking Gemini on every
click would not be a feature.

## Click to node id

Verified against the vendored bundle, not assumed. Every node group is written
with `.attr("id", t.domId || t.id)`, but the two diagram types differ:

- **Flowchart** — dom id embeds the id we wrote: `flowchart-<ourId>-<n>`.
  Parse it back out.
- **Mindmap** — dom id is `node_0`, `node_1`, …, a counter assigned in parse
  order. Our id does not survive. Parse order is our depth-first emission
  order, so the mapping is positional: keep the emission order as an array and
  index into it.

The mindmap correlation is read from the source, not yet seen in Chrome.
Confirm it on the first run before building on it.

## What to get right

- **Drag versus click.** `setupPanZoom()` starts a pan on any `mousedown` over
  the canvas, so a node click would pan too. Treat movement under ~4px between
  down and up as a click.
- **Leaf clicks are a no-op.** Focusing a childless node gives a screen with
  one box on it. Ignore the click; the cursor should not suggest otherwise.
- **The render path becomes a function.** The mindmap→flowchart fallback runs
  once at load today. Every focus change re-runs it, so it has to be callable
  more than once — including the fresh-id-per-attempt detail, which now needs
  to stay unique across renders, not just across the two attempts.
- **Getting back out needs to be visible.** Back on its own is not enough:
  arriving at the L1 view, nothing says the nodes are clickable. A breadcrumb
  of the focus path does both jobs — shows where you are, and clicking a crumb
  jumps straight back to that level. Esc as the keyboard equivalent of back.
- **The header hint is now wrong.** "Drag to pan · scroll to zoom" should say
  something about clicking to focus.
- **Subtree means two things.** For a mindmap, children come from `parent`
  pointers and the children map already exists. For a flowchart the edges make
  a graph rather than a tree, so children are the forward edges out of a node
  and a node can be reached from several parents. Back needs a remembered path
  there, not a `parent` lookup.

Node count and label length still deserve a prompt-side trim, but that is a
separate change and this one removes the pressure for it.
