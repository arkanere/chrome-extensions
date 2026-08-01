const list = document.getElementById('list');

function fmt(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// "https://www.youtube.com/watch?v=..." and "WWW.YouTube.com" both mean youtube.com.
function cleanDomain(input) {
  let v = input.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return v.split('/')[0];
}

async function getSites() {
  const { sites = [] } = await chrome.storage.local.get('sites');
  return sites;
}

async function saveSites(sites) {
  await chrome.storage.local.set({ sites });
  await chrome.runtime.sendMessage({ type: 'sitesChanged' });
  await render();
}

async function render() {
  const { rows = [] } = (await chrome.runtime.sendMessage({ type: 'summary' })) || {};
  list.textContent = '';

  if (!rows.length) {
    const p = document.createElement('div');
    p.className = 'empty';
    p.textContent = 'No sites budgeted yet. Add one below.';
    list.appendChild(p);
    return;
  }

  for (const row of rows) {
    const budget = row.budgetMin * 60;
    const over = row.used >= budget;

    const el = document.createElement('div');
    el.className = over ? 'site over' : 'site';

    const head = document.createElement('div');
    head.className = 'row';
    const name = document.createElement('span');
    name.className = 'domain';
    name.textContent = row.domain;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = over
      ? `${fmt(row.used)} — ${fmt(row.used - budget)} over`
      : `${fmt(row.used)} of ${fmt(budget)}`;
    head.append(name, time);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${Math.min(100, (row.used / budget) * 100)}%`;
    bar.appendChild(fill);

    const controls = document.createElement('div');
    controls.className = 'controls';
    const label = document.createElement('label');
    label.textContent = 'Budget ';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '1440';
    input.value = row.budgetMin;
    input.addEventListener('change', async () => {
      const mins = parseInt(input.value, 10);
      if (!mins || mins < 1) return render();
      const sites = await getSites();
      const site = sites.find((s) => s.domain === row.domain);
      if (site) site.budgetMin = mins;
      await saveSites(sites);
    });
    label.appendChild(input);
    const min = document.createElement('span');
    min.textContent = ' min';
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const remove = document.createElement('button');
    remove.className = 'link';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      const sites = await getSites();
      await saveSites(sites.filter((s) => s.domain !== row.domain));
    });
    controls.append(label, min, spacer, remove);

    el.append(head, bar, controls);
    list.appendChild(el);
  }
}

document.getElementById('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const domainInput = document.getElementById('domain');
  const minutesInput = document.getElementById('minutes');
  const domain = cleanDomain(domainInput.value);
  const budgetMin = parseInt(minutesInput.value, 10);
  if (!domain || !budgetMin) return;

  const sites = await getSites();
  const existing = sites.find((s) => s.domain === domain);
  if (existing) existing.budgetMin = budgetMin;
  else sites.push({ domain, budgetMin });

  domainInput.value = '';
  await saveSites(sites);
});

render();
