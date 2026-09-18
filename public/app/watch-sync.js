// AUREX 5.3. Additive to desk.js and intelligence.js; does not alter slip, AI or booking flows.
// Telegram signed initData is sent in request headers only. Only fixture snapshots are cached locally.
const legacyList = document.querySelector('#watch-items');
const legacyPanel = legacyList?.closest('.desk-panel');
const fixtureRows = document.querySelector('#desk-fixtures');
const watchKey53 = 'aurex-desk-watchlist-v1';
const watchInit = window.Telegram?.WebApp?.initData || '';
const create = (tag, className = '', content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
};
const readLocal = () => {
  try { const items = JSON.parse(localStorage.getItem(watchKey53) || '[]'); return Array.isArray(items) ? items : []; }
  catch { return []; }
};
const saveLocal = (items) => {
  try { localStorage.setItem(watchKey53, JSON.stringify(items)); return true; }
  catch { return false; }
};
const toLocal = (items) => items.map((item) => ({
  id: item.id, sport: item.sport, homeTeam: item.homeTeam, awayTeam: item.awayTeam,
  league: item.league, startsAt: item.startsAt, status: item.status, available: !item.lastError,
}));
const timeWAT = (date) => {
  if (Number.isNaN(Date.parse(date))) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date)) + ' WAT';
};
async function apiWatch(path, body = {}) {
  if (!watchInit) throw new Error('Open the Mini App inside Telegram to synchronize your account.');
  let response;
  try { response = await fetch(`/api/miniapp/watch/${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': watchInit },
    body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) }); }
  catch { throw new Error('Could not reach the watchlist server. No account change was confirmed.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Watchlist operation failed.');
  return data;
}
let cloud = null;
let busy = false;
const panel = create('section', 'desk-panel watch53');
panel.setAttribute('aria-label', 'Cloud watchlist and Telegram notification settings');
const head = create('div', 'desk-heading');
const title = create('div');
title.append(create('p', 'eyebrow', 'AUREX 5.3 · TELEGRAM ACCOUNT'), create('h3', '', 'Synced watchlist'));
const syncButton = create('button', '', 'Sync now');
syncButton.type = 'button';
head.append(title, syncButton);
const banner = create('p', 'watch53-message', 'Connect through Telegram to load your account watchlist.');
banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
const cloudRows = create('div', 'desk-rows');
const importButton = create('button', 'watch53-import hidden', 'Import this device’s saved fixtures');
importButton.type = 'button';
const checkButton = create('button', 'watch53-manual', 'Check watched fixtures now');
checkButton.type = 'button';
const settings = create('form', 'watch53-settings');
const settingsTitle = create('h4', '', 'Telegram alert preferences');
const optLabel = create('label', 'watch53-toggle');
const opt = create('input'); opt.type = 'checkbox'; opt.id = 'watch53-optin';
optLabel.append(opt, create('span', '', 'Enable verified fixture-change notifications'));
const quietLabel = create('label', 'watch53-toggle');
const quiet = create('input'); quiet.type = 'checkbox'; quiet.id = 'watch53-quiet';
quietLabel.append(quiet, create('span', '', 'Use quiet hours (Lagos time)'));
const quietRow = create('div', 'watch53-times');
const startLabel = create('label'); startLabel.append(create('span', '', 'From'));
const start = create('input'); start.type = 'time'; start.value = '22:00'; startLabel.append(start);
const endLabel = create('label'); endLabel.append(create('span', '', 'Until'));
const end = create('input'); end.type = 'time'; end.value = '07:00'; endLabel.append(end);
quietRow.append(startLabel, endLabel);
const saveButton = create('button', 'watch53-save', 'Save preferences'); saveButton.type = 'submit';
const note = create('p', 'desk-note', 'Checks are scheduled daily at 09:00 WAT on production, not live. Only provider-confirmed status or kickoff changes trigger alerts. Unknown fixtures never count as cancelled. Quiet-hour alerts may expire rather than arrive late.');
settings.append(settingsTitle, optLabel, quietLabel, quietRow, saveButton, note);
quiet.addEventListener('change', () => { start.disabled = !quiet.checked; end.disabled = !quiet.checked; });
panel.append(head, banner, cloudRows, importButton, checkButton, settings);
if (legacyPanel) legacyPanel.before(panel);
else document.querySelector('#explore-view')?.append(panel);
function setBanner(message, warning = false) {
  banner.textContent = message;
  banner.dataset.kind = warning ? 'warning' : 'info';
}
function canonicalMatches(canonical) {
  const local = readLocal();
  return local.length === canonical.length && local.every((item, index) =>
    item.id === canonical[index]?.id && item.status === canonical[index]?.status &&
    item.startsAt === canonical[index]?.startsAt && item.homeTeam === canonical[index]?.homeTeam);
}
function draw(data, syncCache = true) {
  cloud = data;
  cloudRows.replaceChildren();
  const items = Array.isArray(data.items) ? data.items : [];
  const remoteIds = new Set(items.map((item) => item.id));
  const extras = readLocal().filter((item) => item && typeof item.id === 'string' && !remoteIds.has(item.id));
  importButton.classList.toggle('hidden', !extras.length);
  importButton.textContent = `Import ${extras.length} device-only fixture${extras.length === 1 ? '' : 's'} to your account`;
  if (legacyPanel) legacyPanel.classList.toggle('hidden', !extras.length);
  if (!items.length) cloudRows.append(create('p', 'desk-empty', 'No synced fixtures yet. Tap Watch + on a verified fixture in Explore.'));
  items.forEach((item) => {
    const row = create('article', 'watch53-row');
    const content = create('div');
    content.append(create('strong', '', `${item.homeTeam} vs ${item.awayTeam}`));
    content.append(create('small', '', `${item.league} · ${timeWAT(item.startsAt)} · ${item.status}`));
    if (item.lastError) content.append(create('small', 'watch53-warning', item.lastError));
    if (item.pending) content.append(create('small', 'watch53-pending', 'Change detected · pending notification or quiet hours'));
    const actions = create('div', 'watch53-row-actions');
    const mute = create('button', '', item.muted ? 'Unmute' : 'Mute'); mute.type = 'button';
    mute.setAttribute('aria-pressed', String(Boolean(item.muted)));
    mute.addEventListener('click', () => action('mute', { eventId: item.id, muted: !item.muted }));
    const remove = create('button', '', 'Remove'); remove.type = 'button';
    remove.addEventListener('click', () => action('toggle', { eventId: item.id, sport: item.sport, watch: false }));
    actions.append(mute, remove); row.append(content, actions); cloudRows.append(row);
  });
  opt.checked = Boolean(data.enabled);
  quiet.checked = Boolean(data.quietStart && data.quietEnd);
  start.value = data.quietStart || '22:00'; end.value = data.quietEnd || '07:00';
  start.disabled = !quiet.checked; end.disabled = !quiet.checked;
  setBanner(data.alertsReady ?
    `Synced ${items.length} fixture${items.length === 1 ? '' : 's'}. Alerts are ${data.enabled ? 'ON' : 'OFF'} · production checks once daily.` :
    `Synced ${items.length} fixture${items.length === 1 ? '' : 's'}. Alert delivery is NOT configured here; settings alone do not send messages.`, !data.alertsReady);
  if (syncCache && !extras.length) {
    const canonical = toLocal(items);
    if (!canonicalMatches(canonical) && saveLocal(canonical)) window.location.reload();
  }
}
async function refresh(cache = true) {
  if (busy) return;
  busy = true; syncButton.disabled = true;
  setBanner('Loading verified account data…');
  try { draw(await apiWatch('state'), cache); }
  catch (error) { setBanner(error instanceof Error ? error.message : 'Sync failed.', true); }
  finally { busy = false; syncButton.disabled = false; }
}
async function action(path, body) {
  if (busy) return;
  busy = true;
  setBanner('Saving your account change…');
  try {
    const data = await apiWatch(path, body);
    // A server-confirmed removal must not be mistaken for an unimported local fixture.
    if (path === 'toggle' && body.watch === false) saveLocal(readLocal().filter((item) => item.id !== body.eventId));
    draw(data);
  } catch (error) { setBanner(error instanceof Error ? error.message : 'Save failed.', true); }
  finally { busy = false; }
}
syncButton.addEventListener('click', () => refresh());
checkButton.addEventListener('click', async () => {
  if (busy) return;
  busy = true; checkButton.disabled = true;
  setBanner('Comparing your watchlist against current provider results…');
  try {
    const result = await apiWatch('check');
    draw(result.state);
    setBanner(`${result.checked} checked · ${result.changed} verified changes · ${result.unavailable} unavailable. Manual check only; no Telegram messages were sent.`, Boolean(result.unavailable));
  } catch (error) { setBanner(error instanceof Error ? error.message : 'Manual check failed.', true); }
  finally { busy = false; checkButton.disabled = false; }
});
settings.addEventListener('submit', async (event) => {
  event.preventDefault();
  await action('settings', { enabled: opt.checked,
    quietStart: quiet.checked ? start.value : null,
    quietEnd: quiet.checked ? end.value : null });
});
importButton.addEventListener('click', async () => {
  if (busy || !cloud) return;
  busy = true; importButton.disabled = true;
  const existing = new Set(cloud.items.map((item) => item.id));
  const extras = readLocal().filter((item) => !existing.has(item.id));
  let added = 0; let failed = 0;
  for (const item of extras) {
    if (item.sport !== 'football' && item.sport !== 'basketball') { failed += 1; continue; }
    try { await apiWatch('toggle', { eventId: item.id, sport: item.sport, watch: true }); added += 1; }
    catch { failed += 1; }
  }
  busy = false; importButton.disabled = false;
  await refresh(false);
  setBanner(`Imported ${added} provider-verified fixtures. ${failed} could not be imported and remain on this device.`, failed > 0);
});
// Preserve desk.js's Watch button, but wait for its target listener to finish
// updating localStorage before calculating the actual server-side change.
document.addEventListener('click', (event) => {
  const button = event.target.closest('#desk-fixtures .desk-row button[aria-pressed]');
  if (!button || !fixtureRows?.contains(button) || !watchInit) return;
  if (busy) {
    event.preventDefault();
    event.stopPropagation();
    setBanner('Watchlist sync is in progress. Please try again when it finishes.', true);
    return;
  }
  const previous = readLocal();
  window.setTimeout(async () => {
    const current = readLocal();
    const priorIds = new Set(previous.map((item) => item.id));
    const currentIds = new Set(current.map((item) => item.id));
    const added = current.find((item) => !priorIds.has(item.id));
    const removed = previous.find((item) => !currentIds.has(item.id));
    if (!added && !removed) return;
    busy = true;
    try {
      const change = added ? { eventId: added.id, sport: added.sport, watch: true } :
        { eventId: removed.id, sport: removed.sport, watch: false };
      const updated = await apiWatch('toggle', change);
      if (removed) saveLocal(current.filter((item) => item.id !== removed.id));
      draw(updated, false);
    } catch (error) {
      saveLocal(previous);
      try { sessionStorage.setItem('aurex-watch53-error', error instanceof Error ? error.message : 'Cloud save failed.'); }
      catch { /* restricted browser */ }
      window.location.reload();
    } finally { busy = false; }
  }, 0);
}, true);
try {
  const error = sessionStorage.getItem('aurex-watch53-error');
  if (error) { setBanner(error, true); sessionStorage.removeItem('aurex-watch53-error'); }
} catch { /* restricted browser */ }
if (watchInit) void refresh();
else setBanner('Preview mode: open through the AUREX Telegram bot to use cloud sync. The browser preview cannot authenticate or send alerts.', true);
