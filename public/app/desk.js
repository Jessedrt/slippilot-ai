// Extra workspace features. Existing app.js remains the owner of slip state and navigation.
// History and watchlist are explicitly device-local; do not persist Telegram init data or signed tokens here.
const desk = document.querySelector('#explore-view');
const slipInsights = document.querySelector('#slip-insights');
const pickList = document.querySelector('#pick-list');
const historyKey = 'aurex-desk-history-v1';
const watchKey = 'aurex-desk-watchlist-v1';
const pendingKey = 'aurex-slip-needs-analysis-v1';
const motionReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (selector) => document.querySelector(selector);

function fromStorage(key) {
  try { const result = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(result) ? result : []; }
  catch { return []; }
}
function saveStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function currentSlip() {
  try {
    const item = JSON.parse(localStorage.getItem('aurex-active-slip') || 'null');
    return item && Array.isArray(item.selections) && typeof item.analysisToken === 'string' ? item : null;
  } catch { return null; }
}
function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = String(text);
  return item;
}
function status(selector, text, error = false) {
  const target = $(selector);
  if (!target) return;
  target.textContent = text;
  target.dataset.kind = error ? 'error' : 'info';
  target.classList.remove('hidden');
}
function dateTime(input) {
  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? 'Time unavailable' :
    new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false }).format(value) + ' WAT';
}
function odds(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—'; }
function empty(container, message) { container.replaceChildren(node('p', 'desk-empty', message)); }
async function request(path, body) {
  const initData = window.Telegram?.WebApp?.initData || '';
  if (!initData) throw new Error('Open AUREX from its Telegram bot to use live data and AI editing.');
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify(body), signal: AbortSignal.timeout(55_000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('Request timed out. The existing slip was not changed.');
    }
    throw new Error('Could not reach AUREX. Check your connection and try again.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || 'The request failed.');
  return result;
}

// --- Live fixture discovery and an explicit, manually refreshed watchlist ---
let fixtureSport = 'football';
let fixturesLoaded = false;
let fixturesBusy = false;
let watchlist = fromStorage(watchKey).filter((item) => item && typeof item.id === 'string').slice(0, 24);
const fixturesContainer = $('#desk-fixtures');
const watchContainer = $('#watch-items');

function watchRow(item, index) {
  const row = node('article', 'desk-row');
  const text = node('div');
  text.append(node('strong', '', `${item.homeTeam || 'Unknown'} vs ${item.awayTeam || 'Unknown'}`));
  text.append(node('small', '', `${item.league || 'Competition not supplied'} · ${dateTime(item.startsAt)} · ${item.available === false ? 'Unverified' : item.status || 'Unknown status'}`));
  const remove = node('button', '', 'Remove');
  remove.type = 'button';
  remove.dataset.unwatch = String(index);
  row.append(text, remove);
  return row;
}
function renderWatchlist() {
  if (!watchContainer) return;
  watchContainer.replaceChildren();
  if (!watchlist.length) { empty(watchContainer, 'Nothing tracked yet. Save a fixture above, then refresh to check its status.'); return; }
  watchlist.forEach((item, index) => watchContainer.append(watchRow(item, index)));
}
function renderFixtures(items) {
  if (!fixturesContainer) return;
  fixturesContainer.replaceChildren();
  if (!items.length) { empty(fixturesContainer, 'No upcoming or live fixtures were returned for today. Try the other sport or refresh later.'); return; }
  items.forEach((fixture) => {
    const row = node('article', 'desk-row');
    const text = node('div');
    text.append(node('strong', '', `${fixture.homeTeam} vs ${fixture.awayTeam}`));
    text.append(node('small', '', `${fixture.league} · ${dateTime(fixture.startsAt)} · ${fixture.status}`));
    const matched = watchlist.find((item) => item.id === fixture.id);
    const toggle = node('button', '', matched ? 'Watching ✓' : 'Watch +');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', String(Boolean(matched)));
    toggle.addEventListener('click', () => {
      const existing = watchlist.findIndex((item) => item.id === fixture.id);
      if (existing >= 0) watchlist.splice(existing, 1);
      else if (watchlist.length < 24) watchlist.unshift({ ...fixture, available: true });
      else { status('#desk-status', 'Watchlist is full (24 fixtures). Remove one first.', true); return; }
      if (!saveStorage(watchKey, watchlist)) {
        status('#desk-status', 'This browser could not save your watchlist. It may be lost on reload.', true);
      }
      toggle.textContent = existing >= 0 ? 'Watch +' : 'Watching ✓';
      toggle.setAttribute('aria-pressed', String(existing < 0));
      renderWatchlist();
      try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.(); } catch { /* optional */ }
    });
    row.append(text, toggle);
    fixturesContainer.append(row);
  });
}
async function loadFixtures(force = false) {
  if (fixturesBusy || (fixturesLoaded && !force)) return;
  fixturesBusy = true;
  const refresh = $('#refresh-fixtures');
  if (refresh) refresh.disabled = true;
  status('#desk-status', `Checking live ${fixtureSport} fixtures…`);
  try {
    const data = await request('/api/miniapp/fixtures', { sport: fixtureSport });
    if (!Array.isArray(data.fixtures)) throw new Error('The provider did not return a fixture list.');
    renderFixtures(data.fixtures);
    fixturesLoaded = true;
    status('#desk-status', `Source: ${data.source || 'fixture provider'} · refreshed ${dateTime(data.refreshedAt)}. Showing ${data.fixtures.length} fixtures.`);
  } catch (error) {
    if (fixturesContainer) empty(fixturesContainer, 'Fixtures could not be verified. No matches have been invented.');
    status('#desk-status', error instanceof Error ? error.message : 'Unable to load fixtures.', true);
  } finally {
    fixturesBusy = false;
    if (refresh) refresh.disabled = false;
  }
}
$('#refresh-fixtures')?.addEventListener('click', () => loadFixtures(true));
desk?.querySelectorAll('[data-fixture-sport]').forEach((button) => {
  button.addEventListener('click', () => {
    fixtureSport = button.dataset.fixtureSport;
    desk.querySelectorAll('[data-fixture-sport]').forEach((item) =>
      item.setAttribute('aria-pressed', String(item === button)));
    fixturesLoaded = false;
    loadFixtures(true);
  });
});
$('#explore-tab')?.addEventListener('click', () => { loadFixtures(); renderWatchlist(); renderHistory(); });
watchContainer?.addEventListener('click', (event) => {
  const index = Number(event.target.closest('[data-unwatch]')?.dataset.unwatch);
  if (!Number.isInteger(index) || !event.target.closest('[data-unwatch]')) return;
  watchlist.splice(index, 1);
  saveStorage(watchKey, watchlist);
  renderWatchlist();
  fixturesLoaded = false;
  loadFixtures(true);
});
$('#refresh-watchlist')?.addEventListener('click', async () => {
  if (!watchlist.length) { status('#watch-status', 'Save a fixture first.'); return; }
  const button = $('#refresh-watchlist');
  button.disabled = true;
  status('#watch-status', 'Checking your watched fixtures against the provider…');
  try {
    const data = await request('/api/miniapp/watchlist-refresh', { ids: watchlist.map((item) => item.id) });
    if (!Array.isArray(data.results)) throw new Error('The provider did not return watchlist results.');
    let changes = 0;
    let unverified = 0;
    watchlist = watchlist.map((item) => {
      const result = data.results.find((entry) => entry.id === item.id);
      if (!result?.available || !result.fixture) { unverified += 1; return { ...item, available: false }; }
      const fresh = result.fixture;
      if (item.status !== fresh.status || item.startsAt !== fresh.startsAt || item.available === false) changes += 1;
      return { ...item, ...fresh, available: true };
    });
    saveStorage(watchKey, watchlist);
    renderWatchlist();
    status('#watch-status', `${changes} status or schedule change${changes === 1 ? '' : 's'} detected · ${unverified} could not be verified · ${dateTime(data.refreshedAt)}. No background notifications.`);
  } catch (error) {
    status('#watch-status', error instanceof Error ? error.message : 'Could not check watchlist.', true);
  } finally { button.disabled = false; }
});
renderWatchlist();

// --- Local, read-only activity history; never retain auth headers or signed tokens ---
let history = fromStorage(historyKey).filter((entry) => entry && typeof entry.id === 'string').slice(0, 20);
function reportPicks(selections) {
  return selections.slice(0, 50).map((item) => ({
    homeTeam: String(item.homeTeam || ''), awayTeam: String(item.awayTeam || ''),
    selectionName: String(item.selectionName || ''), odds: Number(item.odds),
    risk: String(item.risk || 'unknown'), reason: String(item.reason || ''),
  }));
}
function addHistory(entry) {
  history = [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, 20);
  saveStorage(historyKey, history);
  renderHistory();
}
function recordSlip(slip, kind = 'build') {
  if (!slip?.slipId || !Array.isArray(slip.selections) || !slip.selections.length) return;
  if (history.some((item) => item.id === `slip:${slip.slipId}`)) return;
  addHistory({ id: `slip:${slip.slipId}`, kind, analyzedAt: new Date().toISOString(),
    title: kind === 'edit' ? 'Edited slip reviewed' : `${slip.sport || 'Sports'} slip built`,
    summary: String(slip.summary || 'Slip analyzed; review details may be unavailable.'),
    combinedOdds: slip.selections.reduce((value, item) => value * item.odds, 1),
    selections: reportPicks(slip.selections),
  });
}
function renderHistory() {
  const container = $('#history-items');
  if (!container) return;
  container.replaceChildren();
  if (!history.length) { empty(container, 'No saved reports yet. Build or analyze a slip to add a local, read-only snapshot.'); return; }
  history.forEach((entry) => {
    const details = node('details', 'desk-history-entry');
    const summary = node('summary', '', `${entry.title} · ${odds(entry.combinedOdds)} odds`);
    details.append(summary);
    details.append(node('p', 'desk-note', `Saved ${dateTime(entry.analyzedAt)} · Historical snapshot, not live odds.`));
    details.append(node('p', 'insight-summary', entry.summary || 'No summary available.'));
    (Array.isArray(entry.selections) ? entry.selections : []).forEach((pick, index) => {
      details.append(node('p', 'desk-history-pick', `${index + 1}. ${pick.homeTeam} vs ${pick.awayTeam}: ${pick.selectionName} @ ${odds(pick.odds)} · ${pick.risk} risk${pick.reason ? ` — ${pick.reason}` : ''}`));
    });
    container.append(details);
  });
}
$('#clear-history')?.addEventListener('click', () => {
  if (!history.length || !window.confirm('Delete the analysis history saved on this device?')) return;
  history = [];
  try { localStorage.removeItem(historyKey); } catch { /* storage disabled */ }
  renderHistory();
});
document.addEventListener('aurex:code-analyzed', (event) => {
  const data = event.detail;
  if (!data || !Array.isArray(data.selections) || !data.selections.length) return;
  addHistory({ id: `code:${data.code}:${data.analyzedAt || Date.now()}`, kind: 'code',
    title: `Booking code ${data.code} reviewed`, analyzedAt: data.analyzedAt || new Date().toISOString(),
    combinedOdds: data.combinedOdds, summary: String(data.summary || ''),
    selections: reportPicks(data.selections) });
});
renderHistory();

// --- Explanation-rich active slip and signed, genuinely reanalyzed editing ---
function pendingFor(slip) {
  try { return Boolean(slip?.slipId && localStorage.getItem(pendingKey) === slip.slipId); }
  catch { return false; }
}
function markPending(slip) {
  try {
    if (slip?.selections?.length && slip.slipId) localStorage.setItem(pendingKey, slip.slipId);
    else localStorage.removeItem(pendingKey);
  } catch { /* saving may be unavailable in a restricted WebView */ }
}
function cell(label, value) {
  const wrapper = node('div', 'insight-cell');
  wrapper.append(node('span', '', label), node('strong', '', value));
  return wrapper;
}
function renderInsights() {
  if (!slipInsights) return;
  slipInsights.replaceChildren();
  const slip = currentSlip();
  const code = $('#generate-code');
  if (!slip?.selections?.length) {
    markPending(null);
    if (code) code.disabled = false;
    return;
  }
  const picks = slip.selections;
  const actual = picks.reduce((total, pick) => total * Number(pick.odds), 1);
  const risks = { lower: 0, medium: 0, higher: 0 };
  const events = new Set();
  let duplicates = 0;
  picks.forEach((pick) => {
    if (Object.hasOwn(risks, pick.risk)) risks[pick.risk] += 1;
    if (events.has(pick.eventId)) duplicates += 1;
    events.add(pick.eventId);
  });
  slipInsights.append(node('h3', '', 'Slip insights'));
  const grid = node('div', 'insight-grid');
  grid.append(cell('Requested odds', slip.targetOdds == null ? 'Not set' : odds(slip.targetOdds)),
    cell('Actual odds', odds(actual)),
    cell('Selections', `${picks.length}${Number(slip.requestedGames) > picks.length ? ` / ${slip.requestedGames} requested` : ''}`),
    cell('Risk mix', `${risks.lower} lower · ${risks.medium} medium · ${risks.higher} higher`));
  slipInsights.append(grid);
  if (duplicates) slipInsights.append(node('p', 'insight-warning', `${duplicates + 1} or more selections share a fixture. Their outcomes may be correlated; adding them does not diversify the slip.`));
  if (Number(slip.shortfall) > 0) slipInsights.append(node('p', 'insight-warning', `${slip.shortfall} requested selection(s) were not available or accepted. Your actual odds may differ from the target.`));
  if (slip.targetReached === false) slipInsights.append(node('p', 'insight-warning', String(slip.targetMessage || 'Requested target odds were not reached; no unsupported selection was added.')));
  if (slip.evidencePipeline) slipInsights.append(node('p', 'desk-note', `Evidence pipeline: ${String(slip.evidencePipeline)}.`));
  if (slip.analysisTimestamp) slipInsights.append(node('p', 'desk-note', `Analysis completed ${new Date(slip.analysisTimestamp).toLocaleString()}.`));
  if (slip.verification) slipInsights.append(node('p', 'desk-note', `${Number(slip.verification.fixturesMapped) || 0} fixture(s) mapped to the statistics provider; ${Number(slip.verification.mappingRejected) || 0} mapping rejection(s); ${Number(slip.verification.statisticsRejected) || 0} statistical-evidence rejection(s).`));
  if (slip.summary) slipInsights.append(node('p', 'insight-summary', String(slip.summary)));
  slipInsights.append(node('p', 'desk-note', 'AI quality scores are not probabilities of winning. Check kickoff times, live markets and availability.'));
  if (pendingFor(slip)) {
    slipInsights.append(node('p', 'insight-warning', 'Slip edited: reanalyze the remaining selections before generating another code.'));
    if (code) code.disabled = true;
  } else if (code) code.disabled = false;
}
function decoratePickRows() {
  if (!pickList) return;
  pickList.querySelectorAll('.pick-row').forEach((row) => {
    if (row.querySelector('.pick-actions')) return;
    const remove = row.querySelector('[data-remove]');
    if (!remove) return;
    const actions = node('div', 'pick-actions');
    const replace = node('button', '', 'Replace market');
    replace.type = 'button';
    replace.dataset.replace = remove.dataset.remove;
    actions.append(replace, remove);
    row.append(actions);
  });
}
const slipBadge = $('#slip-count');
if (slipBadge) {
  new MutationObserver(() => {
    const slip = currentSlip();
    if (slip?.selections?.length) recordSlip(slip);
    renderInsights();
  }).observe(slipBadge, { childList: true, characterData: true, subtree: true });
}
if (pickList) {
  new MutationObserver(decoratePickRows).observe(pickList, { childList: true, subtree: true });
  pickList.addEventListener('click', (event) => {
    if (!event.target.closest('[data-remove]')) return;
    const slip = currentSlip();
    markPending(slip);
    status('#slip-editor-status', 'Selection removed. Tap Reanalyze to refresh current markets and AI reasoning.');
    // app.js removes the pick after this capture listener; update after its handler.
    queueMicrotask(renderInsights);
  }, { capture: true });
  pickList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-replace]');
    if (!button) return;
    const index = Number(button.dataset.replace);
    if (!Number.isInteger(index) || !window.confirm('Replace this market with another active market on the same fixture? AUREX will reanalyze the whole slip.')) return;
    editSlip('replace', index, button);
  });
}
async function editSlip(action, index, button) {
  const slip = currentSlip();
  if (!slip?.selections?.length || !slip.analysisToken) {
    status('#slip-editor-status', 'No valid analyzed slip is available. Build a fresh slip.', true);
    return;
  }
  button.disabled = true;
  status('#slip-editor-status', action === 'replace' ? 'Finding an alternative and reanalyzing every selection…' : 'Refreshing odds and reanalyzing the slip…');
  try {
    const payload = { action, selections: slip.selections, analysisToken: slip.analysisToken,
      riskMode: slip.riskMode || 'balanced',
      ...(Number.isFinite(Number(slip.targetOdds)) && Number(slip.targetOdds) >= 1.01 ? { targetOdds: Number(slip.targetOdds) } : {}),
      ...(action === 'replace' ? { index } : {}),
    };
    const updated = await request('/api/miniapp/edit-slip', payload);
    if (!updated?.analysisToken || !Array.isArray(updated.selections) || !updated.selections.length) {
      throw new Error('The updated analysis was incomplete; your existing slip was retained.');
    }
    if (!saveStorage('aurex-active-slip', updated)) throw new Error('Browser storage is unavailable. The updated slip could not be saved.');
    recordSlip(updated, 'edit');
    try { localStorage.removeItem(pendingKey); sessionStorage.setItem('aurex-return-to-slip', '1'); }
    catch { /* best effort */ }
    window.location.reload();
  } catch (error) {
    status('#slip-editor-status', error instanceof Error ? error.message : 'The change could not be completed. Original slip retained.', true);
    button.disabled = false;
  }
}
$('#reanalyze-slip')?.addEventListener('click', (event) => editSlip('reanalyze', undefined, event.currentTarget));
$('#slip-tab')?.addEventListener('click', () => { renderInsights(); decoratePickRows(); });
renderInsights();
decoratePickRows();
const onLoad = currentSlip();
if (onLoad?.selections?.length) recordSlip(onLoad);
try {
  if (sessionStorage.getItem('aurex-return-to-slip') === '1') {
    sessionStorage.removeItem('aurex-return-to-slip');
    $('#slip-tab')?.click();
  }
} catch { /* storage disabled */ }
