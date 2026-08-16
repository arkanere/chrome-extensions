// Reads the graph background.js stashed for this tab, turns it into Mermaid
// source, renders it, and wires pan/zoom. Generating the Mermaid here (rather
// than asking the model for it) is what keeps label escaping in one place —
// see visual-diagram-feature-plan.md.
//
// The view never shows the whole graph: it shows one focus node and the level
// directly below it. Clicking a node moves focus down, the breadcrumb and Esc
// move it back up. Each move re-renders from a filtered graph rather than
// hiding nodes, because Mermaid bakes coordinates into the SVG and hidden
// nodes would leave holes.

const canvas = document.getElementById("canvas");
const stage = document.getElementById("stage");
const notice = document.getElementById("notice");
const crumbsEl = document.getElementById("crumbs");
const backBtn = document.getElementById("back");
const allBtn = document.getElementById("showall");

// Used when the graph has no single entry point: a stand-in centre labelled
// with the article title, whose children are the real roots.
const ROOT = "rmroot";

let graph = null;
const nodeById = new Map();
const childrenOf = new Map(); // node id -> child nodes, one level
const edgeLabels = new Map(); // "from\0to" -> edge label (flowchart only)
let path = []; // node ids, root first, current focus last
let showAll = false; // whole graph on screen, focus path kept for the way back
let renderedType = null;
let renderedOrder = null; // mindmap only: dom index -> our node id
let renderSeq = 0;
let fit = () => {};

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
  return { source: lines.join("\n"), order: null };
}

// Mermaid's mindmap grammar has no id references: nesting *is* indentation,
// so this walks parent pointers depth-first at two spaces per level.
//
// `order` is that same depth-first sequence. Mermaid numbers mindmap nodes
// `node_0`, `node_1`, … in parse order and drops our ids, so the emission
// order is the only way back from a clicked element to a node id. The counter
// resets per render (MindmapDB.clear), so the mapping holds for this SVG only.
function mindmapSource(graph) {
  const children = new Map();
  for (const n of graph.nodes) {
    const key = n.parent || "";
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(n);
  }

  const lines = ["mindmap"];
  const order = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (seen.has(node.id)) return; // defensive: a cycle would never return
    seen.add(node.id);
    lines.push(`${"  ".repeat(depth)}${node.id}["${clean(node.label)}"]`);
    order.push(node.id);
    for (const child of children.get(node.id) || []) walk(child, depth + 1);
  };

  const roots = children.get("") || [];
  if (roots.length === 1) {
    // A single root is the article's own centre; use it rather than adding one.
    lines.push(`  ${roots[0].id}(("${clean(roots[0].label)}"))`);
    order.push(roots[0].id);
    seen.add(roots[0].id);
    for (const child of children.get(roots[0].id) || []) walk(child, 2);
  } else {
    lines.push(`  ${ROOT}(("${clean(graph.title)}"))`);
    order.push(ROOT);
    for (const root of roots) walk(root, 2);
  }
  return { source: lines.join("\n"), order };
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

// One level of children per node. A mindmap already carries a tree in its
// `parent` pointers; a flowchart's edges make a graph, so children are the
// forward edges out of a node and a node can be reached from several parents.
// That is why focus is tracked as a remembered path rather than a lookup.
function buildIndex() {
  for (const n of graph.nodes) nodeById.set(n.id, n);

  if (graph.type === "mindmap") {
    for (const n of graph.nodes) {
      if (!n.parent) continue;
      if (!childrenOf.has(n.parent)) childrenOf.set(n.parent, []);
      childrenOf.get(n.parent).push(n);
    }
  } else {
    for (const e of graph.edges) {
      if (e.label) edgeLabels.set(e.from + "\0" + e.to, e.label);
      if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
      const kids = childrenOf.get(e.from);
      if (!kids.some((k) => k.id === e.to)) kids.push(nodeById.get(e.to));
    }
  }

  let roots =
    graph.type === "mindmap"
      ? graph.nodes.filter((n) => !n.parent)
      : graph.nodes.filter((n) => !graph.edges.some((e) => e.to === n.id));
  // A flowchart that is all cycles has no entry node; start somewhere rather
  // than showing nothing.
  if (!roots.length) roots = [graph.nodes[0]];

  if (roots.length === 1) return roots[0].id;
  nodeById.set(ROOT, { id: ROOT, label: graph.title });
  childrenOf.set(ROOT, roots);
  return ROOT;
}

// The graph actually rendered: the focus node plus one level below it.
function subsetFor(focusId) {
  const focus = nodeById.get(focusId);
  const kids = childrenOf.get(focusId) || [];
  const nodes = [
    { id: focus.id, label: focus.label },
    ...kids.map((k) => ({ id: k.id, label: k.label, parent: focus.id })),
  ];
  const edges =
    graph.type === "mindmap"
      ? []
      : kids.map((k) => {
          const label = edgeLabels.get(focus.id + "\0" + k.id);
          return label ? { from: focus.id, to: k.id, label } : { from: focus.id, to: k.id };
        });
  return { type: graph.type, title: graph.title, nodes, edges };
}

// Back from a clicked element to our node id. Both diagram types write the
// group id themselves, but only the flowchart keeps ours inside it.
//
// Both ids also carry the render id as a prefix — Mermaid rewrites every
// node's domId to `${diagramId}-${domId}` on its way into the DOM. Checked in
// Chrome against this bundle: `rm-diagram-3-flowchart-<ourId>-<n>` and
// `rm-diagram-3-node_<n>`. Nothing here may anchor at the start of the id.
function idForElement(el) {
  for (let node = el; node && node !== stage; node = node.parentElement) {
    const domId = node.id;
    if (!domId) continue;
    if (renderedType === "flowchart") {
      const at = domId.lastIndexOf("flowchart-");
      if (at !== -1) {
        // What is left after the prefix and the trailing counter is our id,
        // dashes in it and all.
        const id = domId.slice(at + "flowchart-".length).replace(/-\d+$/, "");
        if (nodeById.has(id)) return id;
      }
    } else {
      // Mindmap drops our id entirely and numbers nodes in parse order, which
      // is the order mindmapSource() emitted them in.
      const m = /node_(\d+)$/.exec(domId);
      if (m && renderedOrder) return renderedOrder[Number(m[1])] || null;
    }
  }
  return null;
}

function hasChildren(id) {
  return Boolean((childrenOf.get(id) || []).length);
}

// Shortest route from the root down to a node, so a click in the whole-diagram
// view can hand the focus view a path it could have walked itself. Breadth
// first because a flowchart node can be reached several ways and the shortest
// is the least surprising of them.
function pathTo(target) {
  const root = path[0];
  const queue = [[root]];
  const seen = new Set([root]);
  while (queue.length) {
    const route = queue.shift();
    const last = route[route.length - 1];
    if (last === target) return route;
    for (const child of childrenOf.get(last) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push([...route, child.id]);
    }
  }
  return [root, target];
}

// Focusing a childless node would give a screen with one box on it, so those
// clicks are ignored — and the cursor should not suggest otherwise. In the
// whole-diagram view the focus node is on screen with everything else, and
// clicking it is the way back into the focus view, so nothing is excluded.
function markClickable() {
  const focusId = showAll ? null : path[path.length - 1];
  for (const group of stage.querySelectorAll("g[id]")) {
    const id = idForElement(group);
    if (id && id !== focusId && hasChildren(id)) group.classList.add("rm-clickable");
  }
}

async function render() {
  // The whole graph is what the focus view exists to avoid, but it is also the
  // only way to see how the parts sit together — so it is a mode, not a
  // default, and every node in it is a way back into the focus view.
  const sub = showAll ? graph : subsetFor(path[path.length - 1]);
  // The mindmap grammar is the fussiest part of Mermaid, so a label it chokes
  // on falls back to a flowchart rather than an empty page. This runs on every
  // focus change, not just at load, so the render id has to stay unique across
  // renders as well as across the two attempts.
  const attempts =
    sub.type === "mindmap"
      ? [
          ["mindmap", mindmapSource],
          ["flowchart", flowchartSource],
        ]
      : [["flowchart", flowchartSource]];

  for (const [type, build] of attempts) {
    try {
      const { source, order } = build(sub);
      mermaid.initialize(themeFor(type));
      const { svg } = await mermaid.render("rm-diagram-" + renderSeq++, source);
      stage.innerHTML = svg;
      renderedType = type;
      renderedOrder = order;
      markClickable();
      fit();
      return true;
    } catch (e) {
      console.warn("Reading Mode: diagram render failed.", e);
    }
  }
  return false;
}

function shorten(text) {
  const label = String(text).replace(/\s+/g, " ").trim();
  return label.length > 28 ? label.slice(0, 27) + "…" : label;
}

// The breadcrumb does two jobs: it says where you are, and it is the only
// thing on screen that hints the nodes are clickable at all.
function drawCrumbs() {
  crumbsEl.textContent = "";
  path.forEach((id, i) => {
    if (i) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      crumbsEl.append(sep);
    }
    const crumb = document.createElement("button");
    crumb.className = "crumb";
    crumb.textContent = shorten(nodeById.get(id).label);
    crumb.title = nodeById.get(id).label;
    // In the whole-diagram view even the last crumb does something: it is the
    // way back to the focus you left.
    crumb.disabled = !showAll && i === path.length - 1;
    crumb.addEventListener("click", () => goTo(path.slice(0, i + 1)));
    crumbsEl.append(crumb);
  });
  crumbsEl.classList.toggle("muted", showAll);
  backBtn.disabled = !showAll && path.length < 2;
  allBtn.textContent = showAll ? "Focus view" : "Show all";
  allBtn.setAttribute("aria-pressed", String(showAll));
}

function goTo(next, all = false) {
  if (next.length === path.length && all === showAll) return;
  path = next;
  showAll = all;
  drawCrumbs();
  render();
}

function setupFocus() {
  let downX = 0;
  let downY = 0;
  canvas.addEventListener("mousedown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  canvas.addEventListener("click", (e) => {
    // A pan starts on any mousedown over the canvas, so anything that moved
    // more than a few pixels was a drag, not a click.
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return;
    const id = idForElement(e.target);
    if (!id || !hasChildren(id)) return;
    // From the whole diagram a click lands on the focus view at that node;
    // from the focus view it steps one level down.
    if (showAll) goTo(pathTo(id));
    else if (id !== path[path.length - 1]) goTo([...path, id]);
  });

  // Back and Esc leave the whole-diagram view first, then step up a level.
  const up = () => (showAll ? goTo(path, false) : goTo(path.slice(0, -1)));
  backBtn.addEventListener("click", up);
  allBtn.addEventListener("click", () => goTo(path, !showAll));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") up();
  });
}

async function main() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return fail("No diagram to show.");

  const key = "rm-diagram-" + id;
  graph = (await chrome.storage.session.get(key))[key];
  if (!graph || !graph.nodes || !graph.nodes.length) {
    return fail("This diagram has expired. Create it again from the reader.");
  }

  document.getElementById("title").textContent = graph.title;
  document.title = graph.title;

  path = [buildIndex()];
  fit = setupPanZoom();
  setupFocus();
  drawCrumbs();

  if (!(await render())) fail("Couldn't draw this diagram.");
}

main();
