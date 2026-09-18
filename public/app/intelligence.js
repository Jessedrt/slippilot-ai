// AUREX 5.2: additive intelligence controls. desk.js remains the owner of watchlist,
// fixture rows and slip editing. Only its fixture request is enriched with current filters.
const intelligenceDesk = document.querySelector('#explore-view');
const fixtureList = document.querySelector('#desk-fixtures');
const fixturePanel = fixtureList?.closest('.desk-panel');
const fixtureRefresh = document.querySelector('#refresh-fixtures');
const slipList = document.querySelector('#pick-list');
const slipContent = document.querySelector('#slip-content');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sourceFetch = window.fetch.bind(window);
const element = (tag, className = '', value) => {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (value !== undefined) result.textContent = String(value);
  return result;
};
const timeText = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Update time unavailable';
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos',
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value)) + ' WAT';
};
const numberText = (value) => Number.isFinite(value) ? value.toFixed(2) : '—';
const note = (container, value, warning = false) => {
  container.textContent = value;
  container.dataset.kind = warning ? 'warning' : 'info';
};
const currentSlip = () => {
  try {
    const value = JSON.parse(localStorage.getItem('aurex-active-slip') || 'null');
    return value?.analysisToken && Array.isArray(value.selections) ? value : null;
  } catch { return null; }
};
async function intelligenceRequest(path, body) {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) throw new Error('Open AUREX through its Telegram bot to check live markets.');
  let response;
  try {
    response = await sourceFetch(path, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify(body), signal: AbortSignal.timeout(55_000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('The market request timed out. Your existing slip was not changed.');
    }
    throw new Error('The provider could not be reached. Try again later.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || 'Could not check the provider.');
  return data;
}

// Filter the source fixture feed, not a hard-coded list or merely the first few DOM rows.
let fixtureRows = [];
let queryField;
let leagueField;
let statusField;
let kickoffField;
let fixtureMeta;
let pendingRefresh = false;
let searchTimer;
const filters = () => ({
  query: queryField?.value.trim() || '', league: leagueField?.value || '',
  status: statusField?.value || 'all', kickoff: kickoffField?.value || 'all',
});
function requestRefresh() {
  if (!fixtureRefresh) return;
  window.clearTimeout(searchTimer);
  if (fixtureRefresh.disabled) { pendingRefresh = true; return; }
  fixtureRefresh.click();
}
function selectField(labelText, values) {
  const label = element('label', 'intel-field');
  label.append(element('span', '', labelText));
  const select = element('select');
  values.forEach(([value, text]) => {
    const option = element('option', '', text);
    option.value = value;
    select.append(option);
  });
  select.addEventListener('change', requestRefresh);
  label.append(select);
  return { label, select };
}
function updateLeagues(leagues) {
  if (!leagueField || !Array.isArray(leagues)) return;
  const previous = leagueField.value;
  leagueField.replaceChildren();
  const all = element('option', '', 'All leagues');
  all.value = '';
  leagueField.append(all);
  leagues.filter((value) => typeof value === 'string').forEach((value) => {
    const option = element('option', '', value);
    option.value = value;
    leagueField.append(option);
  });
  leagueField.value = leagues.includes(previous) ? previous : '';
}
if (fixturePanel && fixtureList) {
  const form = element('form', 'intel-filters');
  form.setAttribute('role', 'search');
  form.setAttribute('aria-label', 'Search and filter provider fixtures');
  const search = element('label', 'intel-field intel-search');
  search.append(element('span', '', 'Find a team or competition'));
  queryField = element('input');
  queryField.type = 'search';
  queryField.placeholder = 'Search today’s fixtures';
  queryField.maxLength = 80;
  queryField.autocomplete = 'off';
  queryField.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(requestRefresh, 320);
  });
  search.append(queryField);
  const league = selectField('League', [['', 'All leagues']]);
  leagueField = league.select;
  const status = selectField('Match status', [['all', 'All statuses'],
    ['scheduled', 'Upcoming'], ['live', 'Live']]);
  statusField = status.select;
  const kickoff = selectField('Kickoff (Lagos time)', [['all', 'Any time today'],
    ['next3h', 'Next 3 hours'], ['evening', 'From 5 PM']]);
  kickoffField = kickoff.select;
  const reset = element('button', 'intel-reset', 'Clear filters');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    queryField.value = '';
    leagueField.value = '';
    statusField.value = 'all';
    kickoffField.value = 'all';
    requestRefresh();
  });
  form.append(search, league.label, status.label, kickoff.label, reset);
  form.addEventListener('submit', (event) => { event.preventDefault(); requestRefresh(); });
  fixtureMeta = element('p', 'intel-meta');
  fixtureMeta.setAttribute('role', 'status');
  fixtureMeta.setAttribute('aria-live', 'polite');
  fixtureMeta.textContent = 'Search teams, leagues, match status and kickoff times.';
  fixtureList.before(form, fixtureMeta);
}

// Keep the established desk.js Watch buttons and rendering. Enrich only its exact
// same-origin fixtures POST, never authentication, slip submission, or any other fetch.
window.fetch = async function aurexFixtureFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  let pathname = '';
  try { pathname = new URL(url, window.location.href).pathname; } catch { /* other fetch */ }
  if (pathname !== '/api/miniapp/fixtures' || init?.method?.toUpperCase() !== 'POST' || !init.body) {
    return sourceFetch(input, init);
  }
  let payload;
  try { payload = JSON.parse(init.body); } catch { return sourceFetch(input, init); }
  const response = await sourceFetch(input, { ...init, body: JSON.stringify({ ...payload, ...filters() }) });
  if (response.ok) {
    try {
      const data = await response.clone().json();
      if (Array.isArray(data.fixtures)) {
        fixtureRows = data.fixtures;
        updateLeagues(data.leagues);
        if (fixtureMeta) {
          const total = Number.isInteger(data.totalMatching) ? data.totalMatching : data.fixtures.length;
          note(fixtureMeta, `${data.fixtures.length} of ${total} matching fixtures · ${data.source || 'Provider'} · checked ${timeText(data.refreshedAt)}${data.truncated ? ' · narrow your search for more' : ''}. Listings do not verify individual markets.`);
        }
      }
    } catch { /* desk.js handles the actual response and error state */ }
  }
  if (pendingRefresh) {
    pendingRefresh = false;
    window.setTimeout(() => requestRefresh(), 75);
  }
  return response;
};

function comparisonPanel(title, parent, before) {
  const section = element('section', 'desk-panel intel-comparison hidden');
  section.setAttribute('aria-label', title);
  const heading = element('div', 'desk-heading');
  const text = element('div');
  text.append(element('p', 'eyebrow', 'LIVE MARKET DATA'), element('h3', '', title));
  const close = element('button', '', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => section.classList.add('hidden'));
  heading.append(text, close);
  const meta = element('p', 'intel-meta');
  meta.setAttribute('role', 'status');
  meta.setAttribute('aria-live', 'polite');
  const rows = element('div', 'intel-market-list');
  section.append(heading, meta, rows);
  if (before) parent.insertBefore(section, before);
  else parent.append(section);
  return { section, meta, rows };
}
const exploreComparison = fixturePanel && intelligenceDesk ?
  comparisonPanel('Compare available markets', intelligenceDesk, fixturePanel.nextSibling) : null;
const slipComparison = slipContent && slipList ?
  comparisonPanel('Compare this selection', slipContent, slipList.nextSibling) : null;

async function compare(eventId, sport, marketId, selectionId, destination) {
  if (!destination) return;
  destination.section.classList.remove('hidden');
  destination.rows.replaceChildren();
  note(destination.meta, 'Checking current markets with the provider…');
  destination.section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
  try {
    const data = await intelligenceRequest('/api/miniapp/compare-markets', {
      eventId, sport, ...(marketId ? { marketId, selectionId } : {}),
    });
    const selected = data.selected;
    note(destination.meta, `${data.fixture.homeTeam} vs ${data.fixture.awayTeam} · ${data.source} · checked ${timeText(data.checkedAt)} · ${data.totalActive} active outcomes returned. Read-only comparison, not an AI recommendation.`);
    if (!data.alternatives.length) {
      destination.rows.append(element('p', 'desk-empty', 'No currently active markets were returned. Nothing was invented.'));
    }
    data.alternatives.forEach((market) => {
      const row = element('article', 'intel-market-row');
      const details = element('div');
      details.append(element('strong', '', market.marketName));
      details.append(element('span', '', market.selectionName));
      const isSelected = selected && selected.marketId === market.marketId &&
        selected.selectionId === market.selectionId;
      if (isSelected) details.append(element('small', 'intel-selected', 'CURRENT SELECTION'));
      const price = element('div', 'intel-price');
      price.append(element('strong', '', numberText(market.odds)));
      if (selected && !isSelected) {
        const delta = market.odds - selected.odds;
        price.append(element('small', '', `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} vs selected`));
      }
      row.append(details, price);
      const freshness = element('small', 'intel-market-time',
        `${market.freshness === 'stale' ? 'Possibly stale · ' : market.freshness === 'unknown' ? 'Update time unknown · ' : ''}Last timestamp ${timeText(market.lastUpdated)}`);
      row.append(freshness);
      destination.rows.append(row);
    });
    (data.warnings || []).forEach((warning) =>
      destination.rows.append(element('p', 'intel-warning', warning)));
    if (marketId) destination.rows.append(element('p', 'desk-note',
      'To change your slip, use its existing Replace market action; comparing does not alter or approve a selection.'));
  } catch (error) {
    note(destination.meta, error instanceof Error ? error.message : 'Comparison unavailable.', true);
    destination.rows.append(element('p', 'desk-empty', 'The existing slip and watchlist are unchanged.'));
  }
}

function decorateFixtures() {
  if (!fixtureList) return;
  const rows = [...fixtureList.querySelectorAll('.desk-row')];
  rows.forEach((row, index) => {
    const fixture = fixtureRows[index];
    if (!fixture || row.querySelector('[data-compare-event]')) return;
    const button = element('button', 'intel-compare-button', 'Compare markets ↗');
    button.type = 'button';
    button.dataset.compareEvent = fixture.id;
    button.addEventListener('click', () => compare(fixture.id, fixture.sport, null, null, exploreComparison));
    row.append(button);
  });
}
if (fixtureList) {
  new MutationObserver(decorateFixtures).observe(fixtureList, { childList: true, subtree: true });
  decorateFixtures();
}
function decorateSlip() {
  if (!slipList) return;
  slipList.querySelectorAll('.pick-row').forEach((row) => {
    const actions = row.querySelector('.pick-actions');
    const remove = actions?.querySelector('[data-remove]');
    if (!actions || !remove || actions.querySelector('[data-compare-pick]')) return;
    const button = element('button', '', 'Compare odds');
    button.type = 'button';
    button.dataset.comparePick = remove.dataset.remove;
    button.addEventListener('click', () => {
      const slip = currentSlip();
      const pick = slip?.selections?.[Number(button.dataset.comparePick)];
      if (!pick) return;
      compare(pick.eventId, pick.sport, pick.marketId, pick.selectionId, slipComparison);
    });
    actions.insertBefore(button, actions.firstChild);
  });
}
if (slipList) {
  new MutationObserver(decorateSlip).observe(slipList, { childList: true, subtree: true });
  decorateSlip();
}

// The existing AI review is not rerun by this button: only source data and market
// availability are verified. The analysis token is bound to the Telegram session.
if (slipContent) {
  const panel = element('section', 'desk-panel intel-reliability');
  panel.setAttribute('aria-label', 'Analysis reliability and source freshness');
  const heading = element('div', 'desk-heading');
  const headingText = element('div');
  headingText.append(element('p', 'eyebrow', 'SOURCE TRANSPARENCY'),
    element('h3', '', 'Analysis reliability'));
  const checkButton = element('button', '', 'Check now');
  checkButton.type = 'button';
  heading.append(headingText, checkButton);
  const intro = element('p', 'desk-note',
    'Verify fixture status, market availability, odds changes and market timestamp. This checks provider data; it does not rerun the AI model.');
  const checkStatus = element('p', 'intel-meta');
  checkStatus.setAttribute('role', 'status');
  checkStatus.setAttribute('aria-live', 'polite');
  checkStatus.textContent = 'No verification has been run for this slip.';
  const reports = element('div', 'intel-reports');
  panel.append(heading, intro, checkStatus, reports);
  const insight = document.querySelector('#slip-insights');
  if (insight) insight.after(panel);
  else slipContent.prepend(panel);
  checkButton.addEventListener('click', async () => {
    const slip = currentSlip();
    if (!slip?.selections?.length) {
      note(checkStatus, 'Build or analyze a slip before checking reliability.', true);
      return;
    }
    if (slip.selections.length > 24) {
      note(checkStatus, 'For now, reliability checks support up to 24 selections per request. Split the slip first.', true);
      return;
    }
    checkButton.disabled = true;
    reports.replaceChildren();
    note(checkStatus, 'Checking the original selections against the provider…');
    try {
      const data = await intelligenceRequest('/api/miniapp/reliability', {
        analysisToken: slip.analysisToken, selections: slip.selections.map((pick) => ({
          eventId: pick.eventId, marketId: pick.marketId, selectionId: pick.selectionId,
          sport: pick.sport, odds: pick.odds,
        })),
      });
      note(checkStatus, `${data.verified}/${data.total} selections met the current source checks · ${data.source} · ${timeText(data.checkedAt)}. The original AI analysis was not rerun.`);
      (data.selections || []).forEach((entry) => {
        const pick = slip.selections[entry.index];
        const item = element('article', 'intel-report');
        item.append(element('strong', '', `${entry.index + 1}. ${pick?.homeTeam || 'Unknown'} vs ${pick?.awayTeam || 'Unknown'}`));
        item.append(element('span', entry.available ? 'intel-ok' : 'intel-bad',
          `${entry.available ? 'Active pre-match market' : 'Market not verified'} · ${entry.fixtureStatus} · ${numberText(entry.previousOdds)} → ${entry.currentOdds == null ? 'Unavailable' : numberText(entry.currentOdds)}`));
        item.append(element('small', '', `Market timestamp: ${timeText(entry.lastUpdated)} · ${entry.freshness}`));
        (entry.warnings || []).forEach((warning) => item.append(element('p', 'intel-warning', warning)));
        reports.append(item);
      });
      (data.missingData || []).forEach((warning) => reports.append(element('p', 'intel-warning', warning)));
    } catch (error) {
      note(checkStatus, error instanceof Error ? error.message : 'Reliability check failed.', true);
      reports.append(element('p', 'desk-empty', 'No new verification was completed. Existing selections were not altered.'));
    } finally { checkButton.disabled = false; }
  });
}
