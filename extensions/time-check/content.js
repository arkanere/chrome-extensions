// Time Check — on-page nag.
//
// Everything lives in a shadow root so no site's CSS can restyle it and our
// CSS can't leak into the page.

(() => {
  const POLL_MS = 15000;
  const MILESTONE_HIDE_MS = 10000;

  let root = null;
  let banner = null;
  let dim = null;
  let hideTimer = null;
  let domain = null;

  function fmt(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h}h ${rest}m` : `${h}h`;
  }

  function build() {
    if (root) return;
    const host = document.createElement('div');
    host.id = 'timecheck-root';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    root = host.attachShadow({ mode: 'closed' });

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .dim {
          position: fixed; inset: 0;
          background: rgba(10, 10, 15, 0.45);
          pointer-events: none;
          opacity: 0; transition: opacity .4s ease;
          z-index: 1;
        }
        .dim.on { opacity: 1; }
        .banner {
          position: fixed; top: 16px; left: 50%;
          transform: translate(-50%, -140%);
          transition: transform .28s cubic-bezier(.2,.8,.2,1);
          display: flex; align-items: center; gap: 14px;
          max-width: min(560px, calc(100vw - 32px));
          padding: 12px 14px 12px 16px;
          border-radius: 12px;
          background: #16161d;
          color: #f2f2f5;
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 12px 40px rgba(0,0,0,.45);
          font: 500 13.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          z-index: 2;
        }
        .banner.show { transform: translate(-50%, 0); }
        .banner.over { background: #2a1416; border-color: rgba(255,120,120,.3); }
        .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #6ea8fe; flex: none;
        }
        .banner.over .dot { background: #ff6b6b; }
        .text { flex: 1; min-width: 0; }
        .title { display: block; }
        .sub { display: block; opacity: .62; font-weight: 400; font-size: 12.5px; margin-top: 2px; }
        button {
          font: 500 12.5px/1 inherit;
          color: #f2f2f5; background: rgba(255,255,255,.1);
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 7px; padding: 7px 10px; cursor: pointer;
          flex: none;
        }
        button:hover { background: rgba(255,255,255,.18); }
      </style>
      <div class="dim"></div>
      <div class="banner">
        <span class="dot"></span>
        <span class="text"><span class="title"></span><span class="sub"></span></span>
        <button class="snooze">Snooze 5 min</button>
      </div>
    `;

    dim = root.querySelector('.dim');
    banner = root.querySelector('.banner');
    root.querySelector('.snooze').addEventListener('click', snooze);
    document.documentElement.appendChild(host);
  }

  function showBanner(title, sub, over) {
    build();
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.toggle('over', over);
    banner.classList.add('show');

    clearTimeout(hideTimer);
    // Milestone pings are informational, so they get out of the way on their
    // own. The over-budget one stays until it's snoozed — that's the point.
    if (!over) hideTimer = setTimeout(() => banner.classList.remove('show'), MILESTONE_HIDE_MS);
  }

  function setDim(on) {
    build();
    dim.classList.toggle('on', on);
  }

  function snooze() {
    clearTimeout(hideTimer);
    if (banner) banner.classList.remove('show');
    setDim(false);
    if (domain) chrome.runtime.sendMessage({ type: 'snooze', domain }).catch(() => {});
  }

  async function poll() {
    if (document.visibilityState !== 'visible') return;
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'status', url: location.href });
    } catch {
      return; // worker restarting, or extension reloaded
    }
    if (!res || !res.tracked) {
      if (dim) setDim(false);
      return;
    }
    domain = res.domain;
    setDim(res.over);
    if (res.over && banner && !banner.classList.contains('show')) {
      showBanner(
        `Over your ${Math.round(res.budget / 60)} min on ${res.domain}`,
        `${fmt(res.used - res.budget)} past the line today.`,
        true
      );
    }
  }

  // readyState > 2 filters out elements that are "playing" but still buffering
  // with nothing on screen.
  function mediaPlaying() {
    return [...document.querySelectorAll('video, audio')].some(
      (m) => !m.paused && !m.ended && m.readyState > 2
    );
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'mediaState') {
      sendResponse({ playing: mediaPlaying() });
      return;
    }
    if (msg.type !== 'nag') return;
    domain = msg.domain;
    const budgetMin = Math.round(msg.budget / 60);
    if (msg.over) {
      showBanner(
        `Over your ${budgetMin} min on ${msg.domain}`,
        `${fmt(msg.used - msg.budget)} past the line today.`,
        true
      );
      setDim(true);
    } else {
      showBanner(
        `${fmt(msg.used)} on ${msg.domain}`,
        `${fmt(msg.budget - msg.used)} left of your ${budgetMin} min today.`,
        false
      );
    }
  });

  // Tell the worker the moment playback starts or stops, so it doesn't have to
  // wait for the next tick. Media events don't bubble, hence capture.
  let mediaTimer = null;
  function mediaChanged() {
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'mediaChanged' }).catch(() => {});
    }, 1000); // debounce: seeking fires pause/play in bursts
  }
  for (const ev of ['play', 'pause', 'ended']) {
    document.addEventListener(ev, mediaChanged, true);
  }

  document.addEventListener('visibilitychange', poll);
  setInterval(poll, POLL_MS);
  poll();
})();
