// YouTube Ad Skipper — click "Skip" as soon as it becomes clickable.
//
// YouTube renders the skip button well before the countdown ends: the element is
// in the DOM the whole time, just hidden or disabled. So the job is not "wait for
// the button to appear", it is "notice the moment it becomes clickable". A short
// poll is the simplest thing that does that, and querySelector over a handful of
// classes costs nothing.
//
// The class names have changed a few times over the years and old ones still show
// up on some clients, so all the ones known to be in use are listed together.
//
// DEBUG adds a second, faster loop that only watches and logs — see the block
// comment above observe(). Set it to false for silent everyday use.

(() => {
  const DEBUG = true;

  const POLL_MS = 200;     // how often we look for a button to click
  const OBSERVE_MS = 25;   // how often the debug watcher looks. never clicks.
  const ESCALATE_MS = 400; // how long a click stage gets before we try the next

  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',        // current
    '.ytp-ad-skip-button-modern', // previous
    '.ytp-ad-skip-button',        // older still
  ];

  const BADGE_SELECTORS = [
    '.ytp-ad-simple-ad-badge',
    '.ytp-ad-badge',
    '.ytp-ad-text',
  ];

  function clickable(el) {
    // offsetParent is null for anything display:none, which is how the button
    // spends the countdown. A zero-size box means it is there but not laid out yet.
    if (!el || el.disabled || el.offsetParent === null) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  // The one place that knows how to find the button. Returns the first clickable
  // match if there is one, otherwise the first match that merely exists — the
  // debug watcher needs to see the button during the countdown, not just after.
  function findButton() {
    let present = null;
    for (const sel of SKIP_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (clickable(el)) return { el, sel, clickable: true };
        if (!present) present = { el, sel, clickable: false };
      }
    }
    return present;
  }

  function adShowing() {
    const player = document.querySelector('#movie_player');
    return !!player && player.classList.contains('ad-showing');
  }

  function badge() {
    for (const sel of BADGE_SELECTORS) {
      const el = document.querySelector(sel);
      const text = el && el.textContent.trim();
      if (text) return text; // usually "Ad 1 of 2", which is how we see a pod
    }
    return '';
  }

  // --- clicking -------------------------------------------------------------
  //
  // el.click() alone does not skip the ad: the log showed the button staying put
  // and being re-clicked every tick, forever. So clicking escalates. Each stage
  // gets ESCALATE_MS to work before the next one is tried, and once the list runs
  // out we stop rather than hammer a button that clearly is not listening.
  //
  // Stage 2 exists because YouTube's player generally drives off pointer events
  // rather than the synthetic click event, and because the handler may sit on a
  // child or an overlay rather than the element we matched — dispatching at the
  // real hit-test target covers both.

  function realClick(el) {
    el.click();
    return el;
  }

  function pointerClick(el) {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;

    // Whatever is actually on top at that point is what a real cursor would hit.
    const target = document.elementFromPoint(x, y) || el;

    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, detail: 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
    };

    for (const type of ['pointerover', 'pointerenter', 'pointermove', 'mousemove',
                        'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const down = type.endsWith('down') || type === 'pointermove' || type === 'mousemove';
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ctor(type, { ...base, buttons: down ? 1 : 0 }));
    }
    return target;
  }

  const STAGES = [
    { name: 'el.click()', run: realClick },
    { name: 'pointer events', run: pointerClick },
  ];

  let attempt = null; // { stage, at } for the button currently on screen

  function skip() {
    const found = findButton();

    // No clickable button: either no ad, or the countdown is still running.
    // Either way the previous attempt is over — the next ad starts fresh.
    if (!found || !found.clickable) {
      attempt = null;
      return;
    }

    const t = performance.now();

    if (!attempt) {
      attempt = { stage: 0, at: t };
    } else if (t - attempt.at < ESCALATE_MS) {
      return; // give the stage we already tried time to take effect
    } else if (attempt.stage + 1 >= STAGES.length) {
      if (DEBUG && !attempt.gaveUp) {
        attempt.gaveUp = true;
        onStuck(found);
      }
      return; // out of ideas. stop hammering.
    } else {
      attempt = { stage: attempt.stage + 1, at: t };
    }

    const stage = STAGES[attempt.stage];
    const target = stage.run(found.el);
    if (DEBUG) onClick(found, stage.name, target);
  }

  setInterval(skip, POLL_MS);

  // --- watching -------------------------------------------------------------
  //
  // Everything below is observation only, and runs at OBSERVE_MS rather than
  // POLL_MS on purpose. If the watcher ran at the same 200ms as the clicker it
  // could never see the cost of the poll — every button would look like it
  // became clickable on the same tick we clicked it. Watching 8x faster means
  // the "clickable -> CLICK" number in the log is the real latency our poll
  // interval is responsible for, which is the number worth tuning against.
  //
  // Timings are relative to the start of the current segment. A segment is one
  // ad: either a fresh `.ad-showing` span, or the next ad in a pod, which we
  // notice by the badge text changing or by our own click not ending the break.

  let seg = null;
  let count = 0; // ads seen in the current break. survives endSeg, unlike seg.

  if (!DEBUG) return;

  function now() {
    return performance.now();
  }

  function line(at, text) {
    const ms = at === null ? '' : `+${Math.round(at - seg.start)}ms`;
    console.log(`[yt-skip] ${ms.padStart(8)}  ${text}`);
  }

  function startSeg(reason) {
    count += 1;
    seg = {
      start: now(),
      n: count,
      badge: badge(),
      inDom: null,
      ready: null,     // first moment the button was clickable
      clicked: null,   // first click only. later stages do not overwrite it.
      described: false,
    };
    console.log(`[yt-skip] ad start  #${seg.n}${seg.badge ? `  "${seg.badge}"` : ''}${reason ? `  (${reason})` : ''}`);
  }

  function endSeg() {
    if (!seg) return;
    if (seg.stuck) {
      line(now(), 'ad ended on its own — nothing we did skipped it');
    } else if (seg.clicked) {
      line(now(), `skipped — ad gone ${Math.round(now() - seg.clicked)}ms after click`);
    } else if (seg.ready) {
      line(now(), 'ad ended, button was clickable but we never clicked — BUG');
    } else {
      line(now(), `ad ended with no skip button — unskippable (${Math.round((now() - seg.start) / 1000)}s watched)`);
    }
    seg = null;
  }

  function onClick(found, stageName, target) {
    if (!seg) return;
    const t = now();
    if (seg.clicked === null) {
      // Only the first click has a meaningful latency. Later ones are retries,
      // and timing them against `ready` just produces a number that grows.
      seg.clicked = t;
      const latency = seg.ready === null ? null : Math.round(t - seg.ready);
      line(t, `CLICK via ${stageName}${latency === null ? '' : `  (latency ${latency}ms, poll is ${POLL_MS}ms)`}`);
    } else {
      line(t, `RETRY via ${stageName} — previous stage did not end the ad`);
    }
    if (target !== found.el) {
      line(t, `  ...dispatched at ${describe(target)}, not the matched element`);
    }
  }

  // Printed once per ad, the moment the button is clickable. This is the raw
  // material for deciding what the button actually is: which selector matched,
  // whether more than one element matched, and what a real cursor would hit at
  // its centre — if that is not the button or a child of it, something is on top.
  function onStuck(found) {
    if (seg) seg.stuck = true;
    line(now(), 'STUCK — every stage tried, ad still showing. structure follows:');
    for (const sel of SKIP_SELECTORS) {
      const all = document.querySelectorAll(sel);
      if (all.length) console.log(`[yt-skip]     ${sel} matched ${all.length}`);
    }
    const box = found.el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    console.log(`[yt-skip]     matched: ${describe(found.el)}`);
    console.log(`[yt-skip]     hit test at centre: ${hit ? describe(hit) : 'nothing'}` +
                `${hit && found.el.contains(hit) ? ' (inside the button — good)' : ' (NOT the button — overlay?)'}`);
    console.log(`[yt-skip]     html: ${found.el.outerHTML.slice(0, 300)}`);
  }

  function describe(el) {
    if (!el) return 'null';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).join('.') : '';
    return `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}>`;
  }

  function observe() {
    const showing = adShowing();

    if (!showing) {
      endSeg();
      count = 0; // the break is over. the next ad is #1 again.
      return;
    }

    const found = findButton();

    if (!seg) {
      startSeg('');
    } else {
      // Next ad in a pod: the badge moved on, or our click cleared one ad but
      // the break is still running. Either way the old segment is done timing.
      const current = badge();
      if (current && current !== seg.badge) {
        endSeg();
        startSeg('next in pod');
      } else if (seg.clicked && !found && now() - seg.clicked > 500) {
        endSeg();
        startSeg('click cleared an ad, break continues');
      }
    }

    if (found && !seg.inDom) {
      seg.inDom = now();
      line(seg.inDom, `button in DOM (${found.sel}, ${found.clickable ? 'clickable' : 'hidden'})`);
    }
    if (found && found.clickable && !seg.ready) {
      seg.ready = now();
      line(seg.ready, `button clickable (${found.sel})`);
    }
  }

  setInterval(observe, OBSERVE_MS);
  console.log(`[yt-skip] logging on (poll ${POLL_MS}ms, watch ${OBSERVE_MS}ms). Set DEBUG=false in content.js to silence.`);
})();
