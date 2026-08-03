// Toolbar click → inject the reader into the active tab. Re-running the
// content script on a tab where it's already loaded toggles the overlay
// (content.js guards with a window flag), so one handler covers open and close.
// Dictionary lookups run here rather than in the content script so page CSP
// can't block them. Single words go to dictionaryapi.dev; phrases (or words
// the dictionary doesn't know) fall back to Wikipedia's summary API.
async function lookup(term) {
  if (/^\S+$/.test(term)) {
    try {
      const r = await fetch(
        "https://api.dictionaryapi.dev/api/v2/entries/en/" +
          encodeURIComponent(term.toLowerCase())
      );
      if (r.ok) {
        const entry = (await r.json())[0];
        return {
          ok: true,
          source: "dictionary",
          word: entry.word,
          phonetic:
            entry.phonetic ||
            (entry.phonetics || []).map((p) => p.text).find(Boolean) ||
            "",
          meanings: (entry.meanings || []).slice(0, 3).map((m) => ({
            pos: m.partOfSpeech,
            defs: m.definitions.slice(0, 2).map((d) => ({
              def: d.definition,
              example: d.example || "",
            })),
          })),
        };
      }
    } catch {
      /* fall through to Wikipedia */
    }
  }
  try {
    const r = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(term) +
        "?redirect=true"
    );
    if (r.ok) {
      const d = await r.json();
      if (d.extract) {
        return {
          ok: true,
          source: "wikipedia",
          word: d.title,
          extract: d.extract,
          url: (d.content_urls && d.content_urls.desktop.page) || "",
        };
      }
    }
  } catch {
    /* no luck anywhere */
  }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "rm-define") {
    lookup(String(msg.term).trim()).then(sendResponse);
    return true; // keep sendResponse alive for the async reply
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:/.test(tab.url ?? "")) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["lib/Readability.js", "content.js"],
    });
  } catch (e) {
    // Pages we can't inject into (Chrome Web Store, PDFs, etc.) — nothing to do.
    console.warn("Reading Mode: cannot run on this page.", e);
  }
});
