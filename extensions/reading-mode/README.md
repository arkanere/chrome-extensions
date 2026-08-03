# Reading Mode

Turn any article into a clean, distraction-free reading view. Click the toolbar
icon to open it; click again or press **Esc** to close. Zero on-screen UI — the
overlay is the article and nothing else.

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
