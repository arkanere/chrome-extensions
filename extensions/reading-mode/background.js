// Toolbar click → inject the reader into the active tab. Re-running the
// content script on a tab where it's already loaded toggles the overlay
// (content.js guards with a window flag), so one handler covers open and close.
// Local key file (gitignored). Missing file just means no Gemini — the
// dictionary/Wikipedia pipeline below still works.
try {
  importScripts("config.js");
} catch {
  /* no config.js — fall back to free lookups */
}

// Context-aware definition via Gemini free tier. Returns null on any failure
// so the caller can fall back.
async function geminiDefine(term, context) {
  const key =
    typeof RM_CONFIG !== "undefined" && RM_CONFIG.GEMINI_API_KEY;
  if (!key) return null;
  const prompt =
    `Explain the meaning of "${term}"` +
    (context ? ` as used in this passage:\n\n"${context}"\n\n` : ". ") +
    "Reply with a plain-text explanation of 2-3 short sentences. " +
    "No markdown, no preamble.";
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    return { ok: true, source: "gemini", word: term, extract: text, url: "" };
  } catch {
    return null;
  }
}

// Dictionary lookups run here rather than in the content script so page CSP
// can't block them. Gemini (if a key is configured) gives context-aware
// answers; otherwise single words go to dictionaryapi.dev and phrases fall
// back to Wikipedia.
async function lookup(term, context) {
  const ai = await geminiDefine(term, context);
  if (ai) return ai;
  return freeLookup(term);
}

async function freeLookup(term) {
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
  // Exact title match first; if the phrase isn't a page name, search for the
  // closest article and summarize that instead.
  const summary = await wikiSummary(term);
  if (summary) return summary;
  try {
    const r = await fetch(
      "https://en.wikipedia.org/w/rest.php/v1/search/page?limit=1&q=" +
        encodeURIComponent(term)
    );
    if (r.ok) {
      const hit = (await r.json()).pages?.[0];
      if (hit) return await wikiSummary(hit.title);
    }
  } catch {
    /* no luck anywhere */
  }
  return { ok: false };
}

async function wikiSummary(title) {
  try {
    const r = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(title) +
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
    /* treat as no match */
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "rm-define") {
    lookup(String(msg.term).trim(), String(msg.context || "").trim()).then(
      sendResponse
    );
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
