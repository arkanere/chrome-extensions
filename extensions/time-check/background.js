// Time Check — service worker.
//
// MV3 kills this worker when idle, so we can't keep a live timer. Instead we
// persist a { domain, start, lastSeen } session and heartbeat it on every
// change (tab switch, focus change, playback, idle) plus a 1-minute alarm.
// Everything is timestamp-based, so a dead worker loses nothing.
//
// Time data is append-only. A finished stretch of attention becomes a segment
// { d, s, e } pushed onto that day's log and never touched again — nothing in
// this file edits or zeroes a recorded number. The single exception is prune(),
// which drops whole days once they age past KEEP_DAYS.

const TICK_ALARM = 'tick';
const LOG_PREFIX = 'log:'; // one storage key per day, so a write never rewrites history
const MAX_GAP = 150000; // ms. Bigger gap than this = the worker was asleep, not you.
const OVER_INTERVAL = 300; // once over budget, nag every 5 min
const SNOOZE_MS = 5 * 60 * 1000;
const KEEP_DAYS = 180;

// Only a backstop for "walked away and left it open" — media playback counts
// as presence on its own, so this can be generous.
const IDLE_SECONDS = 300;

const DEFAULT_SITES = [{ domain: 'youtube.com', budgetMin: 60 }];

// --- helpers ---------------------------------------------------------------

function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function hostFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// A budget on "youtube.com" should also cover "m.youtube.com".
function matchSite(host, sites) {
  if (!host) return null;
  return sites.find((s) => host === s.domain || host.endsWith('.' + s.domain)) || null;
}

// The most recent ping-worthy mark the user has passed today, in seconds.
// Under budget: quarter marks. Over budget: every OVER_INTERVAL past the line.
function highestCrossed(used, budget) {
  if (used >= budget) {
    return budget + Math.floor((used - budget) / OVER_INTERVAL) * OVER_INTERVAL;
  }
  const quarter = budget / 4;
  return Math.floor(used / quarter) * quarter;
}

function fmt(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

// Storage read-modify-write races are real once alarms and events overlap,
// so every mutation goes through this queue.
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

// --- the log ---------------------------------------------------------------

// A stretch of attention can straddle midnight. Split it so every segment
// belongs to exactly one day and a day's total is just a sum of its own key.
function splitByDay(start, end) {
  const out = [];
  let s = start;
  while (s < end) {
    const midnight = new Date(s);
    midnight.setHours(24, 0, 0, 0);
    const boundary = Math.min(midnight.getTime(), end);
    out.push([s, boundary]);
    s = boundary;
  }
  return out;
}

// Append-only: push and never look back.
async function appendSegment(domain, start, end) {
  if (!domain || end - start < 1000) return; // sub-second blips aren't attention

  for (const [s, e] of splitByDay(start, end)) {
    const key = LOG_PREFIX + todayKey(new Date(s));
    const stored = await get(key);
    const segments = stored[key] || [];
    segments.push({ d: domain, s, e });
    await set({ [key]: segments });
  }
}

// Where the in-flight session stands right now. If the heartbeat has gone
// quiet the machine slept, so we trust lastSeen rather than the wall clock.
function liveEnd(session) {
  const now = Date.now();
  return now - session.lastSeen > MAX_GAP ? session.lastSeen : now;
}

// Today's total for one domain: banked segments plus whatever is in flight.
async function usedToday(domain) {
  const key = LOG_PREFIX + todayKey();
  const { [key]: segments = [], session } = await get([key, 'session']);

  let ms = 0;
  for (const g of segments) {
    if (g.d === domain) ms += g.e - g.s;
  }

  if (session && session.domain === domain) {
    const s = Math.max(session.start, startOfToday()); // may have begun yesterday
    const e = liveEnd(session);
    if (e > s) ms += e - s;
  }

  return Math.round(ms / 1000);
}

// --- tracking --------------------------------------------------------------

// Is a video or audio element actually playing in this tab? Asks the content
// script, which can see paused/muted state the tab itself doesn't expose.
async function isMediaPlaying(tab) {
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'mediaState' });
    // We only see the top frame, so an embedded player reads as "not playing".
    // tab.audible covers that, and costs nothing.
    if (res && res.playing) return true;
  } catch {
    // No content script here (PDF viewer, restricted page) — audible is all we have.
  }
  return !!tab.audible;
}

// Which budgeted site is the user spending time on right now? null if none, or
// if Chrome isn't focused, or if the tab is just sitting there abandoned.
async function activeSiteDomain() {
  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState === 'locked') return null; // screen locked, you're definitely gone

  let win;
  try {
    win = await chrome.windows.getLastFocused();
  } catch {
    return null;
  }
  if (!win || !win.focused) return null;

  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab || !tab.url) return null;

  const { sites = [] } = await get('sites');
  const site = matchSite(hostFromUrl(tab.url), sites);
  if (!site) return null;

  // Watching a video counts even when you haven't touched anything for an
  // hour. Only fall back to the idle check when nothing is playing.
  if (idleState !== 'active' && !(await isMediaPlaying(tab))) return null;

  return site.domain;
}

// Extend the current stretch, or close it out and open a new one. This is the
// only place a segment is ever written.
async function retarget() {
  const domain = await activeSiteDomain();
  const { session } = await get('session');
  const now = Date.now();

  if (session && session.domain) {
    // A quiet heartbeat means the machine slept — bank what we know is real
    // and start fresh rather than crediting the whole gap.
    const slept = now - session.lastSeen > MAX_GAP;
    if (session.domain === domain && !slept) {
      await set({ session: { ...session, lastSeen: now } });
      return;
    }
    await appendSegment(session.domain, session.start, session.lastSeen);
  }

  await set({ session: domain ? { domain, start: now, lastSeen: now } : { domain: null } });
}

async function checkNag() {
  const { session, sites = [], nagged = {} } = await get(['session', 'sites', 'nagged']);
  if (!session || !session.domain) return;

  const site = sites.find((s) => s.domain === session.domain);
  if (!site) return;

  const key = todayKey();
  const budget = site.budgetMin * 60;
  const used = await usedToday(site.domain);
  const crossed = highestCrossed(used, budget);
  if (crossed <= 0) return;

  const seen = (nagged[key] && nagged[key][site.domain]) || 0;
  if (crossed <= seen) return;

  nagged[key] = nagged[key] || {};
  nagged[key][site.domain] = crossed;
  await set({ nagged });

  await fireNag(site, used, budget, used >= budget);
}

async function fireNag(site, used, budget, over) {
  chrome.notifications.create(`timecheck-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: over ? `Over budget on ${site.domain}` : `${fmt(used)} on ${site.domain}`,
    message: over
      ? `${fmt(used - budget)} past your ${site.budgetMin} min limit today.`
      : `${fmt(budget - used)} left of your ${site.budgetMin} min today.`,
    priority: 2,
  });

  // A ping the OS swallowed is no ping at all, so also put it on the page.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  chrome.tabs
    .sendMessage(tab.id, { type: 'nag', domain: site.domain, used, budget, over })
    .catch(() => {}); // no content script here (chrome:// page, PDF, etc.)
}

// The one place data leaves. Whole days only, once they age out — never a
// partial edit, never today.
async function prune() {
  const { lastPrune, nagged = {} } = await get(['lastPrune', 'nagged']);
  const today = todayKey();
  if (lastPrune === today) return; // once a day is plenty
  const cutoff = todayKey(new Date(Date.now() - KEEP_DAYS * 86400000));

  let keys;
  try {
    keys = await chrome.storage.local.getKeys();
  } catch {
    keys = Object.keys(await get(null));
  }

  const dead = keys.filter(
    (k) => k.startsWith(LOG_PREFIX) && k.slice(LOG_PREFIX.length) < cutoff
  );
  if (dead.length) await chrome.storage.local.remove(dead);

  for (const day of Object.keys(nagged)) {
    if (day < cutoff) delete nagged[day];
  }
  await set({ nagged, lastPrune: today });
}

// --- wiring ----------------------------------------------------------------

async function init() {
  const { sites, session } = await get(['sites', 'session']);
  if (!sites) await set({ sites: DEFAULT_SITES });
  if (!session) await set({ session: { domain: null } });
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => serial(async () => {
  await init();
  await retarget();
}));

chrome.runtime.onStartup.addListener(() => serial(async () => {
  await init();
  await retarget();
}));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  serial(async () => {
    await retarget(); // heartbeat, and re-check idle/playback
    await checkNag();
    await prune();
  });
});

chrome.tabs.onActivated.addListener(() => serial(retarget));
chrome.windows.onFocusChanged.addListener(() => serial(retarget));
chrome.idle.onStateChanged.addListener(() => serial(retarget));

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.active) return;
  serial(retarget);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Every branch is async, so we always keep the channel open.
  serial(async () => {
    if (msg.type === 'status') {
      // Content script asking: should I be showing anything on this page?
      const host = hostFromUrl(msg.url || (sender.tab && sender.tab.url) || '');
      const { sites = [], snooze = {} } = await get(['sites', 'snooze']);
      const site = matchSite(host, sites);
      if (!site) return sendResponse({ tracked: false });

      const used = await usedToday(site.domain);
      const budget = site.budgetMin * 60;
      const snoozed = (snooze[site.domain] || 0) > Date.now();
      sendResponse({
        tracked: true,
        domain: site.domain,
        used,
        budget,
        over: used >= budget && !snoozed,
      });
    } else if (msg.type === 'snooze') {
      const { snooze = {} } = await get('snooze');
      snooze[msg.domain] = Date.now() + SNOOZE_MS;
      await set({ snooze });
      sendResponse({ ok: true });
    } else if (msg.type === 'summary') {
      // Popup asking for today's numbers.
      const { sites = [] } = await get('sites');
      const rows = [];
      for (const site of sites) {
        rows.push({
          domain: site.domain,
          budgetMin: site.budgetMin,
          used: await usedToday(site.domain),
        });
      }
      sendResponse({ rows });
    } else if (msg.type === 'mediaChanged') {
      await retarget(); // hitting play/pause starts or stops the clock immediately
      sendResponse({ ok: true });
    } else if (msg.type === 'sitesChanged') {
      await retarget(); // the active tab may have just become (un)tracked
      sendResponse({ ok: true });
    } else {
      sendResponse({});
    }
  });
  return true;
});
