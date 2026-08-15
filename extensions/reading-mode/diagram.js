// Reads the graph background.js stashed for this tab, turns it into Mermaid
// source, renders it, and wires pan/zoom. Generating the Mermaid here (rather
// than asking the model for it) is what keeps label escaping in one place —
// see visual-diagram-feature-plan.md.

const canvas = document.getElementById("canvas");
const stage = document.getElementById("stage");
const notice = document.getElementById("notice");

function fail(message) {
  canvas.hidden = true;
  notice.hidden = false;
  notice.textContent = message;
}

// Characters that mean something to the Mermaid parser, gone before they can
// end a quoted label early. Labels are short prose, so this costs little.
function clean(text) {
  return (
    String(text)
      .replace(/\s+/g, " ")
      .replace(/[`"[\]{}<>|;#]/g, "")
      .trim()
      .slice(0, 80) || "…"
  );
}

function flowchartSource(graph) {
  const lines = ["flowchart TD"];
  for (const n of graph.nodes) lines.push(`  ${n.id}["${clean(n.label)}"]`);
  // A mindmap falling back to this shape carries its structure in `parent`,
  // so draw those as edges rather than losing the hierarchy.
  const edges = graph.edges.length
    ? graph.edges
    : graph.nodes.filter((n) => n.parent).map((n) => ({ from: n.parent, to: n.id }));
  for (const e of edges) {
    const arrow = e.label ? `-->|"${clean(e.label)}"|` : "-->";
    lines.push(`  ${e.from} ${arrow} ${e.to}`);
  }
  return lines.join("\n");
}

// Mermaid's mindmap grammar has no id references: nesting *is* indentation,
// so this walks parent pointers depth-first at two spaces per level.
function mindmapSource(graph) {
  const children = new Map();
  for (const n of graph.nodes) {
    const key = n.parent || "";
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(n);
  }

  const lines = ["mindmap"];
  const seen = new Set();
  const walk = (node, depth) => {
    if (seen.has(node.id)) return; // defensive: a cycle would never return
    seen.add(node.id);
    lines.push(`${"  ".repeat(depth)}${node.id}["${clean(node.label)}"]`);
    for (const child of children.get(node.id) || []) walk(child, depth + 1);
  };

  const roots = children.get("") || [];
  if (roots.length === 1) {
    // A single root is the article's own centre; use it rather than adding one.
    lines.push(`  ${roots[0].id}(("${clean(roots[0].label)}"))`);
    seen.add(roots[0].id);
    for (const child of children.get(roots[0].id) || []) walk(child, 2);
  } else {
    lines.push(`  rmroot(("${clean(graph.title)}"))`);
    for (const root of roots) walk(root, 2);
  }
  return lines.join("\n");
}

// The two diagram types need different settings, so each render gets its own
// initialize() call rather than one shared config:
//
// - Flowchart keeps htmlLabels off. Labels are then real SVG text, which is
//   what a canvas can rasterize if export is ever added, and it sizes fine.
// - Mindmap needs htmlLabels ON. With it off, Mermaid mis-measures the label
//   and the text spills outside the node box. Verified in Chrome, both ways.
// - Mindmap also ignores primaryColor: it tints each branch from the cScale
//   palette, so the warm tones have to be set separately or the diagram comes
//   out in Mermaid's default purple and blue.
function themeFor(type) {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const ink = dark ? "#d8d3c8" : "#2b2a27";
  // Mindmap branch tints. They have to sit clear of the page background on
  // both themes — the nodes have no border, so the fill does all the work.
  const branches = dark
    ? ["#3c3730", "#453e33", "#403a30", "#4a4136", "#38332c", "#443d33"]
    : ["#f0e7d5", "#e8ded0", "#efe4d0", "#e5dcc9", "#f2ead9", "#e9e0cd"];

  const themeVariables = {
    background: dark ? "#1c1b19" : "#faf8f2",
    primaryColor: dark ? "#232220" : "#fffdf7",
    primaryTextColor: ink,
    primaryBorderColor: dark ? "#c4a265" : "#8a6d3b",
    lineColor: dark ? "#5c574e" : "#b9b2a4",
    textColor: ink,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: "15px",
  };
  // The mindmap's centre node is not part of the section palette at all: its
  // `.section-root` rule reads `git0`, of all things. Left unset it comes out
  // pure black. Found by testing, not documented.
  themeVariables.git0 = dark ? "#544a38" : "#e6d4ae";

  // Mermaid asks for twelve sections plus a root at index -1, and any it can't
  // find falls back to black — so define the whole range, cycling the tints.
  for (let i = -1; i < 12; i++) {
    const colour = branches[((i % branches.length) + branches.length) % branches.length];
    themeVariables["cScale" + i] = colour;
    themeVariables["cScaleLabel" + i] = ink;
    themeVariables["cScaleInv" + i] = dark ? "#c4a265" : "#8a6d3b";
  }

  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    htmlLabels: type === "mindmap",
    // useMaxWidth off, or Mermaid emits width="100%" and the SVG collapses to
    // the width of the absolutely-positioned stage. We want its natural size
    // and then our own fit.
    flowchart: { htmlLabels: false, curve: "basis", padding: 12, useMaxWidth: false },
    mindmap: { useMaxWidth: false },
    themeVariables,
  };
}

// Drag to pan, wheel to zoom about the pointer. One transform, no library.
function setupPanZoom() {
  let scale = 1;
  let x = 0;
  let y = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const apply = () => {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };

  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add("dragging");
    e.preventDefault();
  });
  addEventListener("mousemove", (e) => {
    if (!dragging) return;
    x += e.clientX - lastX;
    y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });
  addEventListener("mouseup", () => {
    dragging = false;
    canvas.classList.remove("dragging");
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const next = Math.min(4, Math.max(0.15, scale * Math.exp(-e.deltaY / 500)));
      // Keep the point under the cursor fixed while the scale changes.
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      x = px - ((px - x) * next) / scale;
      y = py - ((py - y) * next) / scale;
      scale = next;
      apply();
    },
    { passive: false }
  );

  // Whole diagram in view on arrival, centred. Never scales past 1:1 — a small
  // diagram blown up to fill the window looks like a mistake.
  return function fit() {
    const w = stage.scrollWidth;
    const h = stage.scrollHeight;
    if (!w || !h) return;
    scale = Math.min(1, canvas.clientWidth / w, canvas.clientHeight / h);
    x = (canvas.clientWidth - w * scale) / 2;
    y = (canvas.clientHeight - h * scale) / 2;
    apply();
  };
}

async function main() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return fail("No diagram to show.");

  const key = "rm-diagram-" + id;
  const graph = (await chrome.storage.session.get(key))[key];
  if (!graph || !graph.nodes || !graph.nodes.length) {
    return fail("This diagram has expired. Create it again from the reader.");
  }

  document.getElementById("title").textContent = graph.title;
  document.title = graph.title;

  // The mindmap grammar is the fussiest part of Mermaid, so a label it chokes
  // on falls back to a flowchart rather than an empty page.
  const attempts =
    graph.type === "mindmap"
      ? [["mindmap", mindmapSource(graph)], ["flowchart", flowchartSource(graph)]]
      : [["flowchart", flowchartSource(graph)]];

  let svg = null;
  for (let i = 0; i < attempts.length; i++) {
    const [type, source] = attempts[i];
    try {
      mermaid.initialize(themeFor(type));
      // A fresh id per attempt: a failed render leaves its scratch element
      // behind, and reusing the id would collide with it.
      ({ svg } = await mermaid.render("rm-diagram-" + i, source));
      break;
    } catch (e) {
      console.warn("Reading Mode: diagram render failed.", e);
    }
  }
  if (!svg) return fail("Couldn't draw this diagram.");

  stage.innerHTML = svg;
  setupPanZoom()();
}

main();
