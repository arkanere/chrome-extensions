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

    // Set up by the features below while the overlay is open, and cleared with
    // it. Each is null when the feature is not running.
    dismissPopover: null, // closes the dictionary popover; true if there was one
    stopSpeech: null, // stops the voice; true if it was speaking
    teardownSpeech: null, // stop, unpaint, drop the port
    onArticleChanged: null, // the article's text nodes moved — rebind the speech model
  };

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      // Esc unwinds one layer at a time: an open dictionary popover, then the
      // voice if it is speaking, then the reader itself.
      if (state.dismissPopover && state.dismissPopover()) return;
      if (state.stopSpeech && state.stopSpeech()) return;
      close();
    }
  }

  function close() {
    if (!state.host) return;
    if (state.teardownSpeech) state.teardownSpeech();
    state.dismissPopover = null;
    state.stopSpeech = null;
    state.teardownSpeech = null;
    state.onArticleChanged = null;
    state.host.remove();
    state.host = null;
    document.documentElement.style.overflow = state.savedOverflow;
    document.removeEventListener("keydown", onKeydown, true);
  }

  // chrome.tts speaks at the extension level, not the page's, so leaving the
  // page mid-sentence would otherwise leave the voice talking to an empty room.
  window.addEventListener("pagehide", () => {
    if (state.teardownSpeech) state.teardownSpeech();
  });

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

  // Sticky bar across the top of the reader: article title on the left, tools
  // on the right — the same arrangement pdf-reader and epub-reader use. The
  // diagram button is only added when a Gemini key is configured; unlike
  // Define there is no free fallback, and a dead button is worse than none.
  function setupTopBar(scrollEl, article) {
    const bar = document.createElement("div");
    bar.className = "rm-bar";

    const name = document.createElement("div");
    name.className = "rm-bar-title";
    name.textContent = article.title || document.title;

    const tools = document.createElement("div");
    tools.className = "rm-bar-tools";
    bar.append(name, tools);
    scrollEl.insertBefore(bar, scrollEl.firstChild);

    chrome.runtime.sendMessage({ type: "rm-diagram-available" }, (res) => {
      if (!res || !res.ok) return;
      const btn = document.createElement("button");
      btn.className = "rm-bar-btn";
      btn.textContent = "Create visual diagram";
      tools.appendChild(btn);

      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "Generating…";
        chrome.runtime.sendMessage(
          {
            type: "rm-diagram",
            title: article.title || document.title,
            text: article.textContent,
          },
          (res) => {
            btn.disabled = false;
            btn.textContent = "Create visual diagram";
            if (!res || !res.ok) {
              toast((res && res.error) || "Couldn't build a diagram.");
            }
          }
        );
      });
    });

    // The read-aloud cluster is added here later, once its modules have loaded.
    return { bar, tools };
  }

  // Select text → "Highlight" pill appears → click to mark it. A corner chip
  // counts highlights and copies them all (plain text, blank-line separated)
  // on click. Clicking a highlight removes it. Session-only: everything lives
  // in the overlay and vanishes with it.
  function setupHighlights(shadow, scrollEl, body) {
    let nextId = 1;

    const pill = document.createElement("div");
    pill.className = "rm-pill";
    const hlBtn = document.createElement("span");
    hlBtn.className = "rm-pill-btn";
    hlBtn.textContent = "Highlight";
    const defBtn = document.createElement("span");
    defBtn.className = "rm-pill-btn";
    defBtn.textContent = "Define";
    pill.append(hlBtn, defBtn);
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
        // Define only makes sense for a word or short phrase.
        const term = getSelection().toString().trim();
        defBtn.style.display =
          term && term.length <= 80 && term.split(/\s+/).length <= 8 ? "" : "none";
        pill.classList.add("show");
      }, 0);
    });
    scrollEl.addEventListener(
      "scroll",
      () => {
        hidePill();
        dismissPopover();
      },
      { passive: true }
    );
    scrollEl.addEventListener("mousedown", (e) => {
      if (pop && !pop.contains(e.target)) dismissPopover();
    });

    // mousedown would collapse the selection before click fires.
    pill.addEventListener("mousedown", (e) => e.preventDefault());
    hlBtn.addEventListener("click", () => {
      const range = currentRange();
      hidePill();
      if (!range) return;
      wrapRange(range, String(nextId++));
      getSelection().removeAllRanges();
      updateChip();
      // splitText() has just changed the text nodes the speech model holds.
      if (state.onArticleChanged) state.onArticleChanged();
    });

    // --- Dictionary popover ---------------------------------------------

    let pop = null;

    function dismissPopover() {
      if (!pop) return false;
      pop.remove();
      pop = null;
      return true;
    }
    state.dismissPopover = dismissPopover;

    function el(tag, cls, text) {
      const n = document.createElement(tag);
      n.className = cls;
      if (text) n.textContent = text;
      return n;
    }

    function showPopover(term, context, x, y) {
      dismissPopover();
      pop = el("div", "rm-pop", "Looking up…");
      const w = Math.min(360, innerWidth - 48);
      pop.style.width = w + "px";
      pop.style.left =
        Math.min(Math.max(x - w / 2, 16), innerWidth - w - 16) + "px";
      pop.style.top = Math.max(16, Math.min(y, innerHeight - 336)) + "px";
      scrollEl.appendChild(pop);

      chrome.runtime.sendMessage({ type: "rm-define", term, context }, (res) => {
        if (!pop) return; // dismissed while loading
        pop.textContent = "";
        if (!res || !res.ok) {
          pop.textContent = `No definition found for “${term}”.`;
          return;
        }
        const head = el("div", "rm-pop-term", res.word);
        if (res.source === "dictionary" && res.phonetic) {
          head.appendChild(el("span", "rm-pop-phon", " " + res.phonetic));
        }
        pop.appendChild(head);
        if (res.source === "dictionary") {
          for (const m of res.meanings) {
            pop.appendChild(el("div", "rm-pop-pos", m.pos));
            for (const d of m.defs) {
              const dv = el("div", "rm-pop-def", d.def);
              if (d.example) dv.appendChild(el("div", "rm-pop-ex", "“" + d.example + "”"));
              pop.appendChild(dv);
            }
          }
        } else {
          pop.appendChild(el("div", "rm-pop-def", res.extract));
          if (res.url && /^https:\/\/en\.wikipedia\.org\//.test(res.url)) {
            const a = document.createElement("a");
            a.className = "rm-pop-src";
            a.href = res.url;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = "Wikipedia →";
            pop.appendChild(a);
          } else {
            pop.appendChild(
              el("div", "rm-pop-src", res.source === "gemini" ? "Gemini" : "Wikipedia")
            );
          }
        }
      });
    }

    defBtn.addEventListener("click", () => {
      const term = getSelection().toString().trim();
      // Surrounding paragraph, so an LLM lookup can explain the term as used
      // here rather than in the abstract.
      let context = "";
      const range = currentRange();
      if (range) {
        const c = range.commonAncestorContainer;
        const elc = c.nodeType === Node.TEXT_NODE ? c.parentElement : c;
        const block =
          elc.closest("p, li, blockquote, h1, h2, h3, h4, figcaption, td") || elc;
        context = block.textContent.replace(/\s+/g, " ").trim().slice(0, 600);
      }
      const x = parseFloat(pill.style.left);
      const y = parseFloat(pill.style.top);
      hidePill();
      getSelection().removeAllRanges();
      if (term) showPopover(term, context, x, y);
    });

    body.addEventListener("click", (e) => {
      const m = e.target.closest && e.target.closest("mark.rm-hl");
      if (!m) return;
      const id = m.dataset.hl;
      body.querySelectorAll(`mark.rm-hl[data-hl="${id}"]`).forEach((mk) => {
        while (mk.firstChild) mk.parentNode.insertBefore(mk.firstChild, mk);
        mk.remove();
      });
      // normalize() merges every adjacent text node in the article, not just the
      // ones this highlight touched, so the speech model's nodes are stale
      // whichever way a highlight comes or goes.
      body.normalize();
      updateChip();
      if (state.onArticleChanged) state.onArticleChanged();
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

  // --- Read aloud ---------------------------------------------------------
  //
  // Copied from epub-reader, which already reads aloud over rendered HTML in a
  // shadow root. Everything below this line is wiring; the modules under
  // speech/, player/, core/, view/ and store/ hold the logic. See tts-plan.md.

  // background.js injects content.js as a classic script, which cannot use
  // import statements — so the ES modules are pulled in at runtime instead,
  // which works in a content script's isolated world and keeps every copied
  // file byte-identical to its sibling.
  function loadModules() {
    const load = (path) => import(chrome.runtime.getURL(path));
    return Promise.all([
      load("speech/adapter.js"),
      load("player/controller.js"),
      load("core/text-walk.js"),
      load("core/document-model.js"),
      load("view/controls.js"),
      load("view/highlighter.js"),
      load("store/settings.js"),
    ]);
  }

  // chrome.tts is not exposed to content scripts, so the worker speaks and we
  // drive it over a port. This is a three-method shim with chrome.tts's shape —
  // speech/adapter.js takes its engine as a parameter and never learns that a
  // port is involved.
  function ttsOverPort() {
    const handlers = new Map(); // our token -> the adapter's onEvent
    const voiceWaiters = new Map();
    let port = null;
    let nextToken = 1;
    let nextRequest = 1;
    let keepalive = 0;

    // Word events reset the worker's idle timer on their own, but a long pause
    // between sentences must not be allowed to suspend the worker and take the
    // onEvent listener with it.
    function syncKeepalive() {
      if (handlers.size && !keepalive) {
        keepalive = setInterval(() => port && port.postMessage({ type: "ping" }), 20000);
      } else if (!handlers.size && keepalive) {
        clearInterval(keepalive);
        keepalive = 0;
      }
    }

    function onMessage(msg) {
      if (msg.type === "voices") {
        const waiting = voiceWaiters.get(msg.id);
        voiceWaiters.delete(msg.id);
        if (waiting) waiting(msg.voices);
        return;
      }
      if (msg.type !== "event") return;

      const onEvent = handlers.get(msg.token);
      if (!onEvent) return;
      // Anything that is not a progress event ends the utterance.
      if (msg.event.type !== "start" && msg.event.type !== "word") {
        handlers.delete(msg.token);
        syncKeepalive();
      }
      onEvent(msg.event);
    }

    function connect() {
      if (port) return port;
      port = chrome.runtime.connect({ name: "rm-tts" });
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(() => {
        port = null;
        // A live utterance whose port went away will never report `end`, and the
        // player would wait for it forever. Fail it instead.
        const live = [...handlers.entries()];
        handlers.clear();
        syncKeepalive();
        for (const [, onEvent] of live) {
          onEvent({ type: "error", errorMessage: "the speech connection dropped" });
        }
      });
      return port;
    }

    return {
      getVoices(cb) {
        const id = nextRequest++;
        voiceWaiters.set(id, cb);
        connect().postMessage({ type: "voices", id });
      },

      speak(text, options, cb) {
        const { onEvent, ...rest } = options;
        const token = nextToken++;
        handlers.set(token, onEvent);
        syncKeepalive();
        connect().postMessage({ type: "speak", token, text, options: rest });
        // chrome.tts calls this once the utterance is accepted; a rejection
        // comes back as an error event instead, so there is never a
        // chrome.runtime.lastError for the adapter to find here.
        if (cb) cb();
      },

      stop() {
        handlers.clear();
        syncKeepalive();
        if (port) port.postMessage({ type: "stop" });
      },

      disconnect() {
        this.stop();
        if (port) port.disconnect();
        port = null;
      },
    };
  }

  // caretPositionFromPoint stops at the shadow boundary unless it is handed the
  // roots to look inside.
  function caretAt(x, y, shadow) {
    const pos = document.caretPositionFromPoint?.(x, y, { shadowRoots: [shadow] });
    if (pos && pos.offsetNode?.nodeType === Node.TEXT_NODE) {
      return { node: pos.offsetNode, offset: pos.offset };
    }
    // Older Chrome: the non-standard call, which pierces shadow roots but
    // reports a Range rather than a position.
    const range = document.caretRangeFromPoint?.(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      return { node: range.startContainer, offset: range.startOffset };
    }
    return null;
  }

  // The last word in this text node that starts at or before the caret, which is
  // the word the click is inside. Words are in reading order, so the scan stops
  // as soon as it is past the offset.
  function wordAt(model, node, offset) {
    let hit = null;
    let firstInNode = null;

    for (const sentence of model.sentencesInSection(0)) {
      for (let i = 0; i < sentence.words.length; i++) {
        const word = sentence.words[i];
        if (word.node !== node) continue;
        if (!firstInNode) firstInNode = { sentenceId: sentence.id, wordIndex: i };
        if (word.nodeStart <= offset) hit = { sentenceId: sentence.id, wordIndex: i };
        else return hit ?? firstInNode;
      }
    }
    // Clicking past the last word of a node lands on that word; clicking before
    // the first one lands on it. Both read as "start here".
    return hit ?? firstInNode;
  }

  // A click has to share the page with text selection. A click that moved
  // between press and release, or that ends with text selected, is the user
  // selecting — not asking to be read to.
  const DRAG_SLOP = 4;

  async function setupSpeech(shadow, bar, tools, body, article) {
    // Loading the modules and listing the voices both take a moment, and the
    // reader can be closed inside it. Everything below belongs to this overlay,
    // so a later one must not find half of it wired up.
    const overlay = state.host;
    const stillOpen = () => state.host === overlay;

    let modules;
    try {
      modules = await loadModules();
    } catch (err) {
      // The reader still works without a voice, so this is a warning, not a
      // toast: nothing the reader asked for has failed.
      console.warn("[reading-mode] read aloud unavailable:", err);
      return;
    }
    const [
      speechAdapter,
      playerFactory,
      textWalk,
      modelFactory,
      controlsFactory,
      highlighterFactory,
      settings,
    ] = modules;
    if (!stillOpen()) return;

    const tts = ttsOverPort();
    const speech = speechAdapter.create(tts);
    // The article is one section: there is nothing to page in, so the model's
    // laziness costs nothing and buys the resume lookup.
    const model = modelFactory.create({ sectionCount: 1, runs: () => textWalk.walk(body) });
    await model.ensureSections(1);
    if (!model.sentences.length) return;

    const scrollEl = bar.parentElement;
    const highlighter = highlighterFactory.create(scrollEl, bar);
    // The hash is dropped: two links into the same article are the same read.
    const docKey = location.href.split("#")[0];
    const title = article.title || document.title;

    const prefs = await settings.loadPrefs();
    const voices = await speech.listVoices();
    if (!stillOpen()) {
      tts.disconnect();
      return;
    }
    // A saved voice wins if it is still installed; otherwise the adapter's own
    // chain picks. Audio without highlighting beats no audio.
    const savedVoice = prefs.voice ? voices.find((v) => v.id === prefs.voice) : null;
    let voice = savedVoice || speechAdapter.chooseVoice(voices);
    let rate = prefs.rate ?? 1;

    console.log(
      `[reading-mode] ${model.sentences.length} sentences; voice: ` +
        `${voice ? voice.label : "platform default"}` +
        `${voice && !voice.supportsWordEvents ? " — no word events" : ""}, rate ${rate}`
    );

    const container = document.createElement("div");
    container.className = "rm-controls";
    // Ahead of Create visual diagram, so the cluster sits in the same place in
    // the bar as it does in the siblings' headers.
    tools.insertBefore(container, tools.firstChild);

    const controls = controlsFactory.create(
      container,
      { voices, voice: voice && voice.id, rate, rateRange: speechAdapter.rateRange },
      {
        toggle: () => player.toggle(),
        next: () => player.next(),
        previous: () => player.previous(),
        voice(id) {
          voice = voices.find((v) => v.id === id) || null;
          player.setVoice(id);
          settings.savePrefs({ voice: id });
        },
        rate(value) {
          rate = value;
          player.setRate(value);
          settings.savePrefs({ rate: value });
        },
      }
    );

    const player = playerFactory.create(model, speech, {
      voice: voice && voice.id,
      rate,
      sentenceId: 0,
    });

    player.onState(({ playing }) => controls.setPlaying(playing));
    player.onError((message) => toast(`Speech stopped: ${message}`));
    player.onEnd(() => {
      // Nothing left to resume to. Leaving the position behind would reopen the
      // article on its last sentence forever.
      highlighter.clear();
      settings.clearPosition(docKey);
    });

    // The controller reports where it is, we look the sentence up, and the
    // highlighter draws it. Neither side knows the other.
    let lastSaved = -1;
    player.onPosition((position) => {
      const sentence = model.sentence(position.sentenceId);
      highlighter.show(sentence, position.wordIndex);

      // One write per sentence — a few seconds apart at any speed — rather than
      // one per word, and what is written is the character offset, never the
      // sentence id.
      if (sentence && position.sentenceId !== lastSaved) {
        lastSaved = position.sentenceId;
        settings.savePosition(docKey, sentence.start, title);
      }
    });

    state.stopSpeech = () => {
      if (!player.playing) return false;
      player.pause();
      return true;
    };
    state.teardownSpeech = () => {
      player.pause();
      highlighter.dispose();
      tts.disconnect();
    };
    // The Highlights feature splits and merges the article's text nodes under
    // the model's feet, and the failure is silent — the spoken word simply stops
    // being painted. Re-walking rebinds the same Words to the new nodes;
    // sentence ids never move, so playback never notices.
    state.onArticleChanged = () => {
      if (model.rebindSection(0, textWalk.walk(body))) highlighter.refresh();
    };

    // Click a word to read from there. The browser does the hit test, because
    // the words are real text nodes and a Word records exactly the node and
    // offset the caret APIs report.
    let pressedAt = null;
    body.addEventListener("pointerdown", (e) => {
      pressedAt = { x: e.clientX, y: e.clientY };
    });

    body.addEventListener("click", async (e) => {
      const down = pressedAt;
      pressedAt = null;
      if (!down) return;
      if (Math.abs(e.clientX - down.x) > DRAG_SLOP) return;
      if (Math.abs(e.clientY - down.y) > DRAG_SLOP) return;
      // .rm-scroll claims clicks twice before this one: a link is the article's,
      // and a click on a highlight removed it (that listener ran first, so the
      // mark is already detached — it still answers closest()).
      if (e.target.closest && e.target.closest("a, mark.rm-hl")) return;
      const selection = shadow.getSelection ? shadow.getSelection() : window.getSelection();
      if (selection && !selection.isCollapsed) return;

      const caret = caretAt(e.clientX, e.clientY, shadow);
      if (!caret) return;
      const hit = wordAt(model, caret.node, caret.offset);
      if (!hit) return;

      // Seeking is by sentence, not by word: the adapter speaks a whole
      // Sentence.text and starting mid-string would break the controller's
      // charIndex mapping. Sentences are short, so the clicked word is only ever
      // a moment away.
      await player.seek(hit.sentenceId);
      if (!player.playing) await player.play();
    });

    // Where you stopped, remembered. The offset is looked up rather than a
    // sentence id restored, so an article whose text changed between visits
    // drifts by a line rather than landing somewhere wrong.
    const remembered = await settings.loadPosition(docKey);
    if (!remembered || !stillOpen()) return;
    const sentence = model.sentenceAtOffset(0, remembered.charOffset);
    if (!sentence || sentence.id === 0) return;

    // Seeking rather than only starting there: it emits a Position, which paints
    // the highlight, and reveal() then puts it on screen — nothing has been
    // spoken yet, so draw()'s word-following has no word to follow.
    await player.seek(sentence.id);
    highlighter.reveal();
    toast("Picked up where you stopped reading.");
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
    const { bar, tools } = setupTopBar(page, article);
    setupHighlights(shadow, page, body);
    document.documentElement.appendChild(host);

    state.savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", onKeydown, true);
    state.host = host;

    // After the article is on screen: the text walk reads computed styles to
    // tell a block from an inline, so it needs a laid-out DOM.
    setupSpeech(shadow, bar, tools, body, article);
  }

  window.__readingMode = {
    toggle() {
      state.host ? close() : open();
    },
  };

  window.__readingMode.toggle();
})();
