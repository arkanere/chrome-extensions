// Injected on every toolbar click. First run sets up the controller; every
// run after that just toggles the overlay.
(() => {
  if (window.__readingMode) {
    window.__readingMode.toggle();
    return;
  }

  const state = {
    host: null, // overlay root element, non-null while open
    savedOverflow: "",
    cssText: null, // reader.css, fetched once
  };

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  function close() {
    if (!state.host) return;
    state.host.remove();
    state.host = null;
    document.documentElement.style.overflow = state.savedOverflow;
    document.removeEventListener("keydown", onKeydown, true);
  }

  // Brief notice for pages where no article can be extracted.
  function toast(message) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText =
      "position:fixed;top:24px;left:50%;transform:translateX(-50%);" +
      "z-index:2147483647;background:#2a2a28;color:#faf8f3;" +
      "font:14px/1.4 -apple-system,sans-serif;padding:10px 18px;" +
      "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);" +
      "opacity:0;transition:opacity .25s";
    document.documentElement.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = "1"));
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 2500);
  }

  // Select text → "Highlight" pill appears → click to mark it. A corner chip
  // counts highlights and copies them all (plain text, blank-line separated)
  // on click. Clicking a highlight removes it. Session-only: everything lives
  // in the overlay and vanishes with it.
  function setupHighlights(shadow, scrollEl, body) {
    let nextId = 1;

    const pill = document.createElement("div");
    pill.className = "rm-pill";
    pill.textContent = "Highlight";
    scrollEl.appendChild(pill);

    const chip = document.createElement("div");
    chip.className = "rm-chip";
    scrollEl.appendChild(chip);

    const getSelection = () =>
      shadow.getSelection ? shadow.getSelection() : window.getSelection();

    const hidePill = () => pill.classList.remove("show");

    function currentRange() {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      const c = range.commonAncestorContainer;
      const el = c.nodeType === Node.TEXT_NODE ? c.parentNode : c;
      return body.contains(el) ? range : null;
    }

    // Wrap every text node inside the range in a <mark>. surroundContents()
    // can't cross element boundaries, so split the boundary text nodes and
    // wrap each contained node individually, sharing one highlight id.
    function wrapRange(range, id) {
      if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
        range.setStart(range.startContainer.splitText(range.startOffset), 0);
      }
      if (
        range.endContainer.nodeType === Node.TEXT_NODE &&
        range.endOffset < range.endContainer.data.length
      ) {
        range.endContainer.splitText(range.endOffset);
      }
      let nodes;
      if (
        range.startContainer === range.endContainer &&
        range.startContainer.nodeType === Node.TEXT_NODE
      ) {
        nodes = [range.startContainer];
      } else {
        nodes = [];
        const walker = document.createTreeWalker(
          range.commonAncestorContainer,
          NodeFilter.SHOW_TEXT
        );
        while (walker.nextNode()) {
          const n = walker.currentNode;
          if (!n.data.length || !body.contains(n)) continue;
          // Fully inside the range (boundary-split leftovers compare as -1/1).
          if (
            range.comparePoint(n, 0) === 0 &&
            range.comparePoint(n, n.data.length) === 0
          ) {
            nodes.push(n);
          }
        }
      }
      for (const n of nodes) {
        if (n.parentNode.closest("mark.rm-hl")) continue;
        const mark = document.createElement("mark");
        mark.className = "rm-hl";
        mark.dataset.hl = id;
        mark.title = "Click to remove highlight";
        n.parentNode.replaceChild(mark, n);
        mark.appendChild(n);
      }
    }

    function highlightsText() {
      const groups = new Map();
      for (const m of body.querySelectorAll("mark.rm-hl")) {
        if (!groups.has(m.dataset.hl)) groups.set(m.dataset.hl, "");
        groups.set(m.dataset.hl, groups.get(m.dataset.hl) + m.textContent);
      }
      return [...groups.values()]
        .map((t) => t.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n\n");
    }

    function updateChip() {
      const n = new Set(
        [...body.querySelectorAll("mark.rm-hl")].map((m) => m.dataset.hl)
      ).size;
      chip.textContent = `${n} highlight${n === 1 ? "" : "s"} · Copy`;
      chip.classList.toggle("show", n > 0);
    }

    scrollEl.addEventListener("mouseup", () => {
      // Let the browser finalize the selection first.
      setTimeout(() => {
        const range = currentRange();
        if (!range) {
          hidePill();
          return;
        }
        const rect = range.getBoundingClientRect();
        pill.style.left =
          Math.min(Math.max(rect.left + rect.width / 2, 70), innerWidth - 70) + "px";
        pill.style.top = Math.min(rect.bottom + 10, innerHeight - 52) + "px";
        pill.classList.add("show");
      }, 0);
    });
    scrollEl.addEventListener("scroll", hidePill, { passive: true });

    // mousedown would collapse the selection before click fires.
    pill.addEventListener("mousedown", (e) => e.preventDefault());
    pill.addEventListener("click", () => {
      const range = currentRange();
      hidePill();
      if (!range) return;
      wrapRange(range, String(nextId++));
      getSelection().removeAllRanges();
      updateChip();
    });

    body.addEventListener("click", (e) => {
      const m = e.target.closest && e.target.closest("mark.rm-hl");
      if (!m) return;
      const id = m.dataset.hl;
      body.querySelectorAll(`mark.rm-hl[data-hl="${id}"]`).forEach((mk) => {
        while (mk.firstChild) mk.parentNode.insertBefore(mk.firstChild, mk);
        mk.remove();
      });
      body.normalize();
      updateChip();
    });

    chip.addEventListener("click", async () => {
      const text = highlightsText();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        shadow.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      chip.textContent = "Copied ✓";
      setTimeout(updateChip, 1200);
    });
  }

  async function open() {
    // Parse a clone so Readability never mutates the live page.
    let article = null;
    try {
      article = new Readability(document.cloneNode(true)).parse();
    } catch {
      /* fall through to the toast below */
    }
    if (!article || !article.content || article.length < 200) {
      toast("Reading Mode couldn't find an article on this page.");
      return;
    }

    if (state.cssText === null) {
      const res = await fetch(chrome.runtime.getURL("reader.css"));
      state.cssText = await res.text();
    }

    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:block";
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = state.cssText;
    shadow.appendChild(style);

    // Not "page" — Readability's own output wraps content in class="page",
    // which would collide inside the shadow root.
    const page = document.createElement("div");
    page.className = "rm-scroll";
    const articleEl = document.createElement("article");

    const title = document.createElement("h1");
    title.className = "title";
    title.textContent = article.title || document.title;
    articleEl.appendChild(title);

    const metaBits = [article.byline, article.siteName].filter(Boolean);
    if (metaBits.length) {
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = metaBits.join(" · ");
      articleEl.appendChild(meta);
    }

    const body = document.createElement("div");
    body.className = "body";
    body.innerHTML = article.content;
    // Belt and braces: innerHTML never executes <script>, but drop them and
    // any inline handlers Readability let through.
    body.querySelectorAll("script, style, iframe").forEach((n) => n.remove());
    body.querySelectorAll("*").forEach((n) => {
      for (const attr of [...n.attributes]) {
        if (attr.name.startsWith("on")) n.removeAttribute(attr.name);
      }
    });
    articleEl.appendChild(body);

    page.appendChild(articleEl);
    shadow.appendChild(page);
    setupHighlights(shadow, page, body);
    document.documentElement.appendChild(host);

    state.savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown, true);
    state.host = host;
  }

  window.__readingMode = {
    toggle() {
      state.host ? close() : open();
    },
  };

  window.__readingMode.toggle();
})();
