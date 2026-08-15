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

function apiKey() {
  return (typeof RM_CONFIG !== "undefined" && RM_CONFIG.GEMINI_API_KEY) || "";
}

// One call shape for both features. `model` differs because the two jobs are
// not the same size: a word gets flash-lite, a whole article gets flash.
async function gemini(model, prompt, generationConfig) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey(),
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(generationConfig ? { generationConfig } : {}),
      }),
    }
  );
  if (!r.ok) return null;
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// Context-aware definition via Gemini free tier. Returns null on any failure
// so the caller can fall back.
async function geminiDefine(term, context) {
  const key = apiKey();
  if (!key) return null;
  const prompt =
    `Explain the meaning of "${term}"` +
    (context ? ` as used in this passage:\n\n"${context}"\n\n` : ". ") +
    "Reply with a plain-text explanation of 2-3 short sentences. " +
    "No markdown, no preamble.";
  try {
    const text = await gemini("gemini-flash-lite-latest", prompt);
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

// --- Visual diagram --------------------------------------------------------
//
// The model returns a graph as JSON, not Mermaid source: LLM-written Mermaid
// breaks on unescaped quotes and parentheses in labels, and one parse error
// means a blank page. diagram.js turns the graph into Mermaid itself, so the
// escaping is ours to get right once. See visual-diagram-feature-plan.md.

const MAX_ARTICLE_CHARS = 40000;
const MAX_NODES = 40;

const DIAGRAM_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["mindmap", "flowchart"] },
    title: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          parent: { type: "string" },
        },
        required: ["id", "label"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          label: { type: "string" },
        },
        required: ["from", "to"],
      },
    },
  },
  required: ["type", "title", "nodes", "edges"],
};

function diagramPrompt(title, text) {
  return (
    "You turn an article into a diagram that helps a reader see its structure " +
    "at a glance.\n\n" +
    "Choose ONE shape:\n" +
    '- "mindmap" for articles that explain a topic, a set of ideas, or a ' +
    "taxonomy. Give every node a `parent` (one single root node has no " +
    "parent). Leave `edges` empty.\n" +
    '- "flowchart" for articles that describe a process, a sequence, a ' +
    "causal chain, or an argument. Express every relationship in `edges`, and " +
    "use short `edges[].label` values where the relationship needs a name. " +
    "Leave `parent` unset.\n\n" +
    "Rules: at most " +
    MAX_NODES +
    " nodes; ids are short and unique like n1, n2; labels are the article's " +
    "own ideas in at most 60 characters, no trailing punctuation; `title` is " +
    "a short name for the diagram. Do not invent content that is not in the " +
    "article.\n\n" +
    `ARTICLE TITLE: ${title}\n\nARTICLE:\n${text}`
  );
}

// A schema-conforming response can still be an unrenderable graph, so nothing
// reaches the tab unvalidated. Returns null if too little survives to draw.
function cleanGraph(raw) {
  if (!raw || typeof raw !== "object") return null;

  const nodes = [];
  const byId = new Map();
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    const id = typeof n?.id === "string" && n.id.trim();
    const label = typeof n?.label === "string" && n.label.trim();
    if (!id || !label || byId.has(id)) continue;
    const node = { id, label };
    if (typeof n.parent === "string" && n.parent.trim()) node.parent = n.parent.trim();
    nodes.push(node);
    byId.set(id, node);
    if (nodes.length === MAX_NODES) break;
  }
  if (nodes.length < 2) return null;

  // Parents that point at a dropped node, at themselves, or around a cycle
  // would all hang the depth-first walk in diagram.js.
  for (const node of nodes) {
    if (node.parent && (!byId.has(node.parent) || node.parent === node.id)) {
      delete node.parent;
    }
  }
  for (const node of nodes) {
    const seen = new Set([node.id]);
    let cur = node;
    while (cur.parent) {
      if (seen.has(cur.parent)) {
        delete cur.parent;
        break;
      }
      seen.add(cur.parent);
      cur = byId.get(cur.parent);
    }
  }

  const edges = [];
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    const from = typeof e?.from === "string" && e.from.trim();
    const to = typeof e?.to === "string" && e.to.trim();
    if (!from || !to || from === to || !byId.has(from) || !byId.has(to)) continue;
    const edge = { from, to };
    if (typeof e.label === "string" && e.label.trim()) edge.label = e.label.trim();
    edges.push(edge);
  }

  // Trust what the model actually produced over what it labelled the graph:
  // a flowchart with no usable edges still draws fine as a tree, and a
  // mindmap whose nodes are all roots does not.
  let type = raw.type === "mindmap" ? "mindmap" : "flowchart";
  if (type === "flowchart" && !edges.length) type = "mindmap";
  if (type === "mindmap" && !nodes.some((n) => n.parent)) {
    if (!edges.length) return null;
    type = "flowchart";
  }

  return {
    type,
    title: (typeof raw.title === "string" && raw.title.trim()) || "Diagram",
    nodes,
    edges,
  };
}

// Generates, then opens the tab — so the wait happens in the reader, where the
// button is, and a failure never leaves an empty tab behind.
async function makeDiagram(title, text) {
  if (!apiKey()) return { ok: false, error: "No Gemini key configured." };
  let raw = null;
  try {
    const json = await gemini(
      "gemini-flash-latest",
      diagramPrompt(title, text.slice(0, MAX_ARTICLE_CHARS)),
      { responseMimeType: "application/json", responseSchema: DIAGRAM_SCHEMA }
    );
    if (json) raw = JSON.parse(json);
  } catch {
    /* network, quota, or malformed JSON — all one message to the reader */
  }
  const graph = cleanGraph(raw);
  if (!graph) return { ok: false, error: "Couldn't build a diagram for this article." };

  // storage.session rather than a variable here: the service worker can be
  // terminated between this and the tab loading. Entries are small and die
  // with the browser, so there is nothing to clean up — and keeping them means
  // reloading the diagram tab still works.
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ ["rm-diagram-" + id]: graph });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`diagram.html?id=${id}`) });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "rm-diagram-available") {
    sendResponse({ ok: Boolean(apiKey()) });
    return;
  }
  if (msg && msg.type === "rm-diagram") {
    makeDiagram(String(msg.title || ""), String(msg.text || "")).then(sendResponse);
    return true;
  }
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
