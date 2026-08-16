# Read aloud — feature plan

Have the article read to you, with the word being spoken lit up as it goes.
`pdf-reader` and `epub-reader` already do this. This is the same feature, in the
same clothes, for web pages.

The goal is **parity, not invention**: the same controls in the same order, the
same two highlight colours, the same stop-and-remember pause, the same
click-a-word-to-read-from-there gesture. Someone who uses two of these
extensions should not have to learn a second interface.

## Shape of it

The top bar gains the sibling extensions' control cluster — `↑`, **Read aloud**,
`↓`, a speed slider, a voice picker. Pressing Read aloud walks the rendered
article into sentences, hands them to Chrome's local neural voices one at a
time, and paints the current word and the sentence around it with the CSS
Custom Highlight API. The page follows the voice. Click any word to start
reading from there. Voice and speed are remembered; so is where you stopped in
each article.

`epub-reader` is what this is copied from, not `pdf-reader`. It already reads
aloud over rendered HTML inside a shadow root, which is exactly our situation,
and its phase 7 fixed two things pdf-reader still gets wrong: highlights that
survive reflow, and resume positions that survive a change to the sentence
splitter.

## What is copied

Everything from `../epub-reader/`, following the repo rule that an extension
folder is self-contained and shared code is copied rather than linked:

| File | Treatment |
|---|---|
| `speech/adapter.js` | verbatim |
| `player/controller.js` | verbatim |
| `core/text-walk.js` | verbatim |
| `core/document-model.js` | verbatim |
| `view/controls.js` | verbatim |
| `view/highlighter.js` | one change — the scroll container |
| `store/settings.js` | one change — positions keyed by URL, not by file hash |

That is five files byte-identical to their siblings and two nearly so. It is
also the **third** copy of each, which is the strongest argument yet for the
`shared/` folder that `epub-reader`'s section 12 defers. Not now — but the next
time one of these files needs the same edit three times, do it.

## Decisions

**`chrome.tts`, spoken by the service worker.** Our reader is a content script,
and `chrome.tts` is not exposed to content scripts. So `background.js` does the
speaking and `content.js` drives it over a long-lived `chrome.runtime.connect`
port: `speak`/`stop` down, `start`/`word`/`end`/`error` back up.

The alternative was `window.speechSynthesis`, which needs no messaging at all.
It was rejected because Chrome's good voices there are remote and emit no
word-boundary events, and the word highlight is half the feature. `chrome.tts`
also has no user-activation gate, which is why both siblings chose it.

This costs almost nothing, because `speech/adapter.js` already takes the engine
as a parameter — `create(tts = chrome.tts)`. A three-method shim over the port
(`getVoices`, `speak`, `stop`) satisfies it, and the adapter is copied
untouched. The port is the seam; the adapter never learns it exists.

**Playback state stays in the page, not in the worker.** MV3 workers suspend
after ~30s idle, so a position kept there would evaporate. The worker holds no
state beyond the live utterance: it is a speaker, not a player.

**One sentence per utterance.** Unchanged from the siblings, for the reason they
measured: synthesis latency scales with input size — ~3s for a paragraph, ~200ms
for a sentence — so a paragraph-sized utterance is heard as a stall.

**Pause is stop-and-remember, never `chrome.tts.pause()`.** Drop the utterance,
keep the position, re-speak the sentence from its start on resume. One code path
then serves pause, seek, voice change, speed change and resume-on-open.

**The highlight is painted by the browser, not by markup.** `CSS.highlights` +
`::highlight()` paints a `Range` without touching the DOM. Wrapping spoken words
in elements would fight the `mark.rm-hl` wrapping that the Highlights feature
already does, and would mutate the article under the reader's feet on every
word.

**Controls go in the existing top bar.** In `.rm-bar-tools`, beside *Create
visual diagram*. Same widgets and same order as the siblings' header, restyled
with the `rm-` prefix against `reader.css`'s warm palette rather than the
siblings' greys — parity of arrangement, not of colour.

## Amended promise

The README says highlights and diagrams are session-only and that nothing is
persisted. Remembering the voice, the speed and where you stopped ends that, and
the README needs saying so plainly rather than quietly going out of date. The
in-page Highlights feature stays session-only; this is the first thing Reading
Mode keeps.

## Pipeline

1. **`content.js`** — after `open()` renders the article, `core/text-walk.js`
   walks `.body` into text runs and `core/document-model.js` turns them into
   sentences and words. The article is one section:
   `create({ sectionCount: 1, runs: () => walk(body) })`.
2. **`view/controls.js`** builds the cluster into an `.rm-controls` container in
   `.rm-bar-tools`, and reports every change back to `content.js`.
3. **`player/controller.js`** speaks `sentence.text` through the adapter, maps
   each `charIndex` back to a word, and emits a `Position` only when the word
   actually changes — which is what collapses the two boundary events per word
   that Natural voices fire.
4. **`speech/adapter.js`** → the port shim → **`background.js`** → `chrome.tts`.
   Events come back stamped with the utterance token; anything from a dead token
   is dropped.
5. **`view/highlighter.js`** builds two `Range`s from the position and hands
   them to `CSS.highlights`, scrolling `.rm-scroll` only when the word has
   actually left the comfortable band.
6. **`store/settings.js`** writes `prefs { voice, rate }` and
   `positions { <url>: { charOffset, title, at } }` to `chrome.storage.local`.

## Surprises worth knowing

- **`.rm-scroll` is the scroll container, not the window.** It is
  `position: fixed; inset: 0; overflow-y: auto`, so every `window.scrollBy` and
  `window.innerHeight` in the copied highlighter becomes `scrollEl.scrollBy` and
  `scrollEl.clientHeight`. Because the scroller is pinned at `inset: 0`,
  viewport and scroller coordinates coincide, so `getBoundingClientRect()` needs
  no translation. The siblings' `HEADER = 92` becomes the measured height of the
  sticky `.rm-bar`.

- **The Highlights feature destroys the speech model's nodes.** This is the one
  that will waste a day if it is not known up front. `wrapRange()` calls
  `splitText()` on the boundary text nodes, and removing a highlight calls
  `body.normalize()`, which merges every adjacent text node in the article.
  Either way, a `Word`'s `{ node, nodeStart }` now points at a node that has
  changed length or no longer exists — and the failure is **silent**: `rangeFor`
  returns null and the spoken word simply stops being painted.

  `epub-reader` hit this from a different direction (chapters torn down on
  scroll) and already has the answer: `model.rebindSection(0, runs)`, which
  re-walks and swaps the new nodes into the existing `Word` objects, verifying
  sentence count, texts and word counts match before it writes anything. So:
  re-walk and rebind after every highlight add and remove, then
  `highlighter.refresh()`. Sentence ids never move, so playback never notices.

- **`::highlight()` rules must live inside the shadow root.** The registration in
  `CSS.highlights` is global; the *styling* resolves against the tree the range
  lives in. `reader.css` is already injected into the shadow root as a `<style>`,
  so that is where the rules go — and a copy anywhere else would paint nothing.
  Colours are the siblings' exactly: `rgba(255, 214, 102, .34)` for the sentence,
  `rgba(255, 165, 38, .6)` for the word.

- **ES modules need dynamic `import()`.** `background.js` injects classic scripts
  via `chrome.scripting.executeScript({ files })`, which cannot use `import`
  statements. The copied files are ES modules, so `content.js` pulls them in with
  `await import(chrome.runtime.getURL("speech/adapter.js"))` — which works in a
  content script's isolated world and keeps every copy byte-identical. The module
  paths need adding to `web_accessible_resources` beside `reader.css`.

  **This is not yet proven in this extension**, which is why phase 1 exists to
  prove it before anything is built on it. If it fails, the fallback is to strip
  the `export` keywords and hang the modules off a single `window.__rmSpeech`
  namespace — which costs the verbatim-copy property, and should be written down
  as a cost rather than waved through.

- **Click-to-read comes last in the click precedence.** `caretPositionFromPoint`
  needs handing the shadow root explicitly —
  `caretPositionFromPoint(x, y, { shadowRoots: [shadow] })` — or it stops at the
  boundary. And `.rm-scroll` already claims clicks twice: `mouseup` raises the
  selection pill, and a click on `mark.rm-hl` removes a highlight. Read-from-here
  fires only when neither did and the selection is collapsed, with the siblings'
  `DRAG_SLOP = 4` guard so that dragging to select still selects.

- **A resume position is a character offset, not a sentence id.** A sentence id
  is an index into a list the splitter produced, so any later change to the
  splitter would silently move every saved position. An offset does not. It also
  absorbs the thing books never had to worry about: an article's text can change
  between visits, and `sentenceAtOffset` falling back to the nearest following
  sentence is what makes that a small drift rather than a wrong place.

- **The port keeps the worker alive.** Word events flow every few hundred
  milliseconds and reset the idle timer, and the model's 45-word sentence cap
  means no single utterance runs near 30s. A 20-second keepalive ping while
  playing is cheap insurance against a suspension killing the `onEvent` listener
  mid-sentence.

- **`tts` is the only permission this adds.** `storage` is already there for the
  diagram feature. No new host permissions: the Natural voices synthesise
  locally, so nothing about this leaves the browser.

## Phases

Each is loadable in Chrome on its own. There is no test suite; the exit criteria
are the checklist.

**1 — Speech over the port.** `background.js` gains the port handler;
`content.js` lists the voices and speaks one hard-coded sentence.
*Done when:* a sentence is audible, the voice list is in the console, and the
dynamic `import()` of `speech/adapter.js` resolved. This phase deliberately
answers the two open risks — the port and the module loading — before anything
depends on them.

**2 — Text model.** Copy `core/text-walk.js` and `core/document-model.js`; walk
`.body`.
*Done when:* the sentences match the rendered article read by eye, headings do
not run into the paragraph below them, and a word split across an inline element
(`dis<em>connect</em>ed`) is one word whose range stringifies back to itself.

**3 — Playback.** Copy `player/controller.js` and wire it.
*Done when:* an article reads aloud end to end from the console, and reaching
the end stops cleanly.

**4 — Highlight and follow.** Copy `view/highlighter.js` with the scroll
container change; add the `::highlight()` rules to `reader.css`.
*Done when:* the spoken word is lit, the sentence band is unbroken across line
wraps, and stepping several hundred words scrolls a handful of times rather than
once per word.

**5 — Controls, click-to-read, persistence, rebind.** Copy `view/controls.js`
and `store/settings.js`; wire the bar, the click gesture, the Esc chain
(popover → stop speech → close), and the rebind.
*Done when:* voice and speed survive a reload, an article reopens at its
remembered sentence with the page scrolled to it, clicking a word reads from
there while dragging still selects — and, specifically, adding a highlight and
then removing it mid-playback leaves the spoken word still painting.

## What was built

All five phases landed together, in one commit, rather than one commit each.
Phase 1's throwaway console harness was therefore never written: its two risks
were answered by the real code instead, which means the first load of the
finished feature is what proves them. If the dynamic `import()` fails, the
console says `[reading-mode] read aloud unavailable:` and the reader still
opens, reads, highlights and defines exactly as before — speech is the only
thing lost, and the fallback above is what to reach for.

The plan survived contact almost intact. Seven files were copied, five of them
byte-identical to `epub-reader`'s (`cmp` says so); the port carried the
adapter untouched. What follows is where the built thing differs from the page
above, and why.

**The highlights are named `rm-word` and `rm-sentence`.** `CSS.highlights` is a
global registry shared with the page and with any other extension on it, so the
names are prefixed like everything else here.

**The highlighter gained `dispose()`.** `epub-reader`'s viewer is a tab that
lives once; this overlay is built and destroyed on every toggle. Without taking
the two entries back out of `CSS.highlights`, a reopened reader registers over
ranges pointing into a document that no longer exists.

**The keepalive lives in the content script, not the worker,** and pings only
while an utterance is actually live rather than on a permanent timer. A port
that pings forever would keep the worker awake forever.

**A dropped port is reported as an error, not a silence.** If the port goes away
mid-sentence the utterance can never report `end`, and the controller would wait
for it for the rest of the session. The shim synthesises an `error` event for
every live utterance instead, which is a shape the adapter already handles.

**A rejected utterance comes back the same way.** The shim's `speak` callback
cannot reproduce `chrome.runtime.lastError` — it is not running inside a Chrome
API callback — so the worker turns a rejection into an `error` event. The
adapter's `lastError` branch is therefore dead code in this copy, and stays only
because the file is byte-identical to its siblings by design.

**`setupSpeech` is async, so it checks the reader is still open.** Loading seven
modules and listing ~190 voices takes long enough to close the reader inside it.
Every await is followed by a `stillOpen()` test, or a second overlay would find
half of the first one wired into it.

**No controls at all when there is nothing to read,** rather than
`epub-reader`'s disabled ones. There is no second document coming — an article
with no words never gains any — so a permanently dead cluster is worse than an
absent one.

**The position key drops the URL's hash.** Two links into the same article are
one read.

**The resume announces itself.** `epub-reader` puts it in the notice bar, which
this reader does not have; a toast says *Picked up where you stopped reading*.
Without it, an article that opens scrolled halfway down reads as a bug.

**The cluster sits ahead of Create visual diagram** in `.rm-bar-tools`, so its
place in the bar matches the siblings' headers.

The README's promise was amended as section *Amended promise* asked: highlights
are still session-only, and a new *What is stored* section says what is not.

## Not in v1

**Keyboard shortcuts.** Space for play/pause, arrows to skip. Space also
scrolls, so this needs a decision about focus rather than a `keydown` handler,
and both siblings deferred it for exactly that reason. When it is done it should
be done in all three extensions at once.

**Reading the page without the reader.** Speech is bolted to the extracted
article, so a page Readability cannot parse gets no speech either. Fixing that
means a second text source, not a second player.
