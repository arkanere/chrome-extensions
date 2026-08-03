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
