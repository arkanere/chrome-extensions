// YouTube Ad Skipper — end a skippable ad the moment it can be skipped.
//
// The skip button is the trigger, not the mechanism: pressing it does nothing
// (see the block comment above seekPastAd), so its appearance is only used as
// the signal that this ad is allowed to end, and the ad is then seeked past.
//
// YouTube renders that button well before the countdown ends — it is in the DOM
// the whole time, hidden. So the job is not "wait for the button to appear", it
// is "notice the moment it becomes clickable". A short poll is the simplest
// thing that does that, and querySelector over a few classes costs nothing.
//
// The class names have changed a few times over the years and old ones still show
// up on some clients, so all the ones known to be in use are listed together.
//
// DEBUG adds a second, faster loop that only watches and logs — see the block
// comment above observe(). Set it to false for silent everyday use.

(() => {
  const DEBUG = true;

  const POLL_MS = 200;     // how often we look for a skippable ad, and retry
  const OBSERVE_MS = 25;   // how often the debug watcher looks. never acts.

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

  // --- skipping -------------------------------------------------------------
  //
  // We do not press the skip button. Three ads' worth of logs say a scripted
  // press is ignored: el.click() did nothing, and neither did a full pointer
  // sequence dispatched at the real hit-test target, with the STUCK dump ruling
  // out overlays and ghost elements. Events made by script carry
  // isTrusted: false, and a content script cannot forge a trusted one. So both
  // click stages were deleted rather than kept as dead fallbacks.
  //
  // What works is moving the video element itself, which involves no handler at
  // all. YouTube plays the content once the ad runs out.
  //
  // It is retried every tick rather than once, and that is the whole lesson of
  // the pod: the first ad ignored a seek at +5.8s and played on to +13s, while
  // the second obeyed instantly. A seek to a time outside video.seekable does
  // nothing, and an ad is not always seekable to its end the moment the skip
  // button appears. Retrying costs one assignment per tick and covers it.
  //
  // The danger is that the ad and the real video are the same <video> element,
  // so a seek at the wrong moment fast-forwards what you actually wanted to
  // watch. Two conditions must hold: the player is in its ad state, and a
  // clickable skip button is on screen. skip() checks the first before anything
  // else, and seekPastAd() checks it again — deliberate duplication, because
  // this is the one operation here that can ruin a viewing.

  function video() {
    return document.querySelector('#movie_player video');
  }

  function seekPastAd() {
    if (!adShowing()) return null;

    const v = video();
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return null;

    v.currentTime = v.duration;

    // Reading it straight back says whether the seek was taken. A target outside
    // video.seekable is refused and currentTime stays put, which is exactly what
    // the first ad of a pod does until it has buffered to the end.
    return { video: v, accepted: v.currentTime >= v.duration - 0.5 };
  }

  let attempt = null; // the seek run against the button currently on screen

  function skip() {
    // Nothing below runs outside an ad. This is a safety gate, not tidiness.
    if (!adShowing()) {
      attempt = null;
      return;
    }

    const found = findButton();

    // No clickable button: the countdown is still running, or this ad has no
    // skip at all. Either way the previous run is over and the next starts fresh.
    if (!found || !found.clickable) {
      attempt = null;
      return;
    }

    const t = performance.now();
    if (!attempt) attempt = { first: t, tries: 0, moaned: false };
    attempt.tries += 1;

    const sought = seekPastAd();

    if (DEBUG) onSeek(attempt, sought, t);
  }

  setInterval(skip, POLL_MS);

  // --- watching -------------------------------------------------------------
  //
  // Everything below is observation only, and runs at OBSERVE_MS rather than
  // POLL_MS on purpose. If the watcher ran at the same 200ms as the clicker it
  // could never see the cost of the poll — every button would look like it
  // became clickable on the same tick we acted on it. Watching 8x faster means
  // the "clickable -> SEEK" number in the log is the real latency our poll
  // interval is responsible for, which is the number worth tuning against.
  //
  // Timings are relative to the start of the current segment. A segment is one
  // ad: either a fresh `.ad-showing` span, or the next ad in a pod, which we
  // notice by the badge text changing or by our own seek not ending the break.

  let seg = null;
  let count = 0; // ads seen in the current break. survives endSeg, unlike seg.

  if (!DEBUG) return;

  function now() {
    return performance.now();
  }

  // `seg` can legitimately be null here: a stale skip button can outlive the ad
  // state by a tick or two, and the clicker will report on it. Without the null
  // check this threw on every poll.
  function line(at, text) {
    const ms = at === null || !seg ? '' : `+${Math.round(at - seg.start)}ms`;
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
      seeked: null,   // first seek attempt. retries do not overwrite it.
      accepted: null, // first seek the video actually took. null means refused.
      guarded: false,
    };
    console.log(`[yt-skip] ad start  #${seg.n}${seg.badge ? `  "${seg.badge}"` : ''}${reason ? `  (${reason})` : ''}`);
  }

  function endSeg() {
    if (!seg) return;
    if (seg.accepted !== null) {
      line(now(), `skipped — ad gone ${Math.round(now() - seg.accepted)}ms after the seek landed`);
    } else if (seg.seeked !== null) {
      line(now(), 'ad played out — every seek was refused, nothing we did skipped it');
    } else if (seg.ready) {
      line(now(), 'ad ended, button was clickable but we never seeked — BUG');
    } else {
      line(now(), `ad ended with no skip button — unskippable (${Math.round((now() - seg.start) / 1000)}s watched)`);
    }
    seg = null;
  }

  function onSeek(attempt, sought, t) {
    if (!seg) return;

    if (seg.seeked === null) {
      seg.seeked = t;
      const latency = seg.ready === null ? null : Math.round(t - seg.ready);
      line(t, `SEEK past ad${latency === null ? '' : `  (latency ${latency}ms, poll is ${POLL_MS}ms)`}`);
    }

    if (sought === null) {
      if (!seg.guarded) {
        seg.guarded = true;
        line(t, '  ...seek did nothing, its guard did not hold');
      }
      return;
    }

    // The moment a seek is actually taken. Everything before this was refused.
    if (sought.accepted && seg.accepted === null) {
      seg.accepted = t;
      if (attempt.tries > 1) {
        line(t, `seek accepted on try ${attempt.tries}, ${Math.round(t - attempt.first)}ms after the first`);
      }
      return;
    }

    // Still being refused a second in. Print what the video says about itself
    // once, then let the retries get on with it quietly.
    if (!sought.accepted && !attempt.moaned && t - attempt.first > 1000) {
      attempt.moaned = true;
      const v = sought.video;
      line(t, `seek refused ${attempt.tries} times — retrying every ${POLL_MS}ms`);
      console.log(`[yt-skip]     currentTime ${v.currentTime.toFixed(2)} of duration ${v.duration.toFixed(2)}`);
      console.log(`[yt-skip]     seekable: ${ranges(v.seekable)}  buffered: ${ranges(v.buffered)}`);
    }
  }

  function ranges(list) {
    if (!list || !list.length) return 'none';
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      out.push(`${list.start(i).toFixed(2)}-${list.end(i).toFixed(2)}`);
    }
    return out.join(', ');
  }

  function describe(el) {
    if (!el || !el.tagName) return 'nothing';
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
      // Next ad in a pod: the badge moved on, or our seek cleared one ad but
      // the break is still running. Either way the old segment is done timing.
      const current = badge();
      if (current && current !== seg.badge) {
        endSeg();
        startSeg('next in pod');
      } else if (seg.seeked !== null && !found && now() - seg.seeked > 500) {
        endSeg();
        startSeg('seek cleared an ad, break continues');
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
