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

  const POLL_MS = 200;   // how often we look for a button to click
  const OBSERVE_MS = 25; // how often the debug watcher looks. never clicks.

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

  function skip() {
    const found = findButton();
    if (found && found.clickable) {
      found.el.click();
      if (DEBUG) onClick(found.sel);
    }
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

  if (!DEBUG) return;

  let seg = null;
  let count = 0; // ads seen in the current break. survives endSeg, unlike seg.

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
      ready: null,   // first moment the button was clickable
      clicked: null,
      warned: false,
    };
    console.log(`[yt-skip] ad start  #${seg.n}${seg.badge ? `  "${seg.badge}"` : ''}${reason ? `  (${reason})` : ''}`);
  }

  function endSeg() {
    if (!seg) return;
    if (seg.clicked) {
      line(now(), `skipped — ad gone ${Math.round(now() - seg.clicked)}ms after click`);
    } else if (seg.ready) {
      line(now(), 'ad ended, button was clickable but we never clicked — BUG');
    } else {
      line(now(), `ad ended with no skip button — unskippable (${Math.round((now() - seg.start) / 1000)}s watched)`);
    }
    seg = null;
  }

  function onClick(sel) {
    if (!seg) return;
    seg.clicked = now();
    const latency = seg.ready ? Math.round(seg.clicked - seg.ready) : null;
    line(seg.clicked, `CLICK  ${sel}${latency === null ? '' : `  (latency ${latency}ms, poll is ${POLL_MS}ms)`}`);
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

    // We clicked, the ad is still here, and the button still is too. The click
    // was rejected — worth knowing, because it means .click() is not enough and
    // a real pointer event sequence would be needed.
    if (seg.clicked && !seg.warned && now() - seg.clicked > 1000 && found && found.clickable) {
      seg.warned = true;
      line(now(), 'still showing 1s after CLICK, button still clickable — click had no effect');
    }
  }

  setInterval(observe, OBSERVE_MS);
  console.log(`[yt-skip] logging on (poll ${POLL_MS}ms, watch ${OBSERVE_MS}ms). Set DEBUG=false in content.js to silence.`);
})();
