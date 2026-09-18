// A pasted code stays in memory until explicitly moved to My Slip. Never store Telegram initData here.
const style = document.createElement('link');
style.rel = 'stylesheet'; style.href = '/app/code-workspace.css?v=5.4.0';
document.head.append(style);
const analysisResult = document.querySelector('#analysis-result');
const panel = document.createElement('section');
panel.className = 'desk-panel code-workspace hidden';
panel.setAttribute('aria-label', 'Edit and trim an analyzed booking code');
analysisResult?.after(panel);
let slip = null, pending = false, busy = false, optionsIndex = -1, options = [];
const node = (tag, cls = '', text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = String(text);
  return el;
};
const fmt = (n) => Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '—';
const product = (selections) => selections.reduce((n, pick) => n * pick.odds, 1);
const state = node('p', 'code-workspace-status');
state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
function message(text, warning = false) {
  state.textContent = text; state.dataset.kind = warning ? 'error' : 'info';
}
async function api(path, body) {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) throw new Error('Open the AUREX Mini App from Telegram for verified editing.');
  let response;
  try { response = await fetch(path, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
    body: JSON.stringify(body), signal: AbortSignal.timeout(55_000) }); }
  catch { throw new Error('Provider unavailable or request timed out. No bet was placed.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Provider request failed.');
    error.status = response.status; error.data = data; throw error;
  }
  return data;
}
function button(text, handler, disabled = false) {
  const el = node('button', '', text); el.type = 'button'; el.disabled = disabled;
  el.addEventListener('click', handler); return el;
}
function render() {
  if (!analysisResult || !slip?.selections?.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden'); panel.replaceChildren();
  const heading = node('div', 'desk-heading'), headingText = node('div');
  headingText.append(node('p', 'eyebrow', 'VERIFIED CODE WORKSPACE'), node('h3', '', 'Edit & trim code'));
  heading.append(headingText, node('strong', 'code-workspace-odds', `${fmt(product(slip.selections))} odds`));
  const intro = node('p', 'desk-note',
    `Original code: ${slip.sourceCode || 'Imported'} · ${slip.selections.length} editable picks. The original code never changes.`);
  const summary = node('p', 'desk-note', slip.summary || 'AI review completed.');
  const rows = node('div', 'code-workspace-list');
  slip.selections.forEach((pick, i) => {
    const row = node('article', 'code-workspace-row');
    const label = node('div');
    label.append(node('strong', '', `${i + 1}. ${pick.homeTeam} vs ${pick.awayTeam}`),
      node('small', '', `${pick.marketName} · ${pick.selectionName} @ ${fmt(pick.odds)} · ${pick.risk} risk`));
    const actions = node('div', 'code-workspace-actions');
    actions.append(button('Edit odds / market', () => void loadOptions(i), pending),
      button('Remove', () => {
        if (busy) return;
        if (slip.selections.length < 2) { message('At least one pick must remain.', true); return; }
        slip.selections.splice(i, 1); pending = true; optionsIndex = -1;
        render(); message('Pick removed. Reanalyze remaining markets before creating another code.');
      }));
    row.append(label, actions); rows.append(row);
  });
  const form = node('form', 'code-workspace-trim');
  const label = node('label');
  label.append(node('span', '', 'Trim to maximum combined odds'));
  const target = node('input'); target.type = 'number'; target.min = '1.01';
  target.step = '0.01'; target.placeholder = 'e.g. 5 or 10'; target.required = true;
  target.setAttribute('aria-label', 'Maximum combined odds'); label.append(target);
  const trim = node('button', '', 'Trim selections'); trim.type = 'submit';
  form.append(label, trim, node('p', 'desk-note',
    'Only whole picks can be removed. An exact target is not guaranteed; check all remaining games.'));
  form.addEventListener('submit', (event) => {
    event.preventDefault(); if (busy) return;
    const max = Number(target.value);
    if (!Number.isFinite(max) || max < 1.01) { message('Enter a valid odds target of at least 1.01.', true); return; }
    let items = [...slip.selections];
    if (product(items) <= max) { message('The current slip is already at or below that target.'); return; }
    while (product(items) > max && items.length > 1) {
      const possible = items.map((_pick, i) => ({ i, odds: product(items.filter((_item, j) => i !== j)) }));
      const sufficient = possible.filter((item) => item.odds <= max).sort((a, b) => b.odds - a.odds);
      const remove = sufficient[0] || possible.sort((a, b) => a.odds - b.odds)[0];
      if (!remove) break;
      items.splice(remove.i, 1);
    }
    if (product(items) > max) {
      message(`The last remaining pick exceeds ${fmt(max)} odds. Edit that market to choose a lower-priced outcome.`, true);
      return;
    }
    const removed = slip.selections.length - items.length;
    slip.selections = items; pending = true; optionsIndex = -1;
    render(); message(`Removed ${removed} pick(s). Estimate ${fmt(product(items))} versus ${fmt(max)} target. Review and reanalyze.`);
  });
  const alternativePanel = node('div', 'code-workspace-options');
  if (optionsIndex >= 0) {
    alternativePanel.append(node('h4', '', 'Choose a specific active market'),
      node('p', 'desk-note', 'These are SportyBet snapshots, not AI recommendations. Your full slip will be reanalyzed.'));
    if (!options.length) alternativePanel.append(node('p', 'desk-empty', 'No eligible active outcomes were returned.'));
    options.forEach((item) => {
      const current = slip.selections[optionsIndex];
      if (current?.marketId === item.marketId && current?.selectionId === item.selectionId &&
        (current?.specifier ?? null) === item.specifier) return;
      alternativePanel.append(button(`${item.marketName} · ${item.selectionName} @ ${fmt(item.odds)}`,
        () => void choose(optionsIndex, item), pending));
    });
    alternativePanel.append(button('Close choices', () => { optionsIndex = -1; render(); }));
  }
  const toolbar = node('div', 'code-workspace-toolbar');
  toolbar.append(button(pending ? 'Reanalyze changes' : 'Refresh analysis', () => void reanalyze()),
    button('Generate NEW booking code', () => void generate(), pending),
    button('Move to My Slip', () => saveToSlip(), pending));
  panel.append(heading, intro, summary, rows, form, alternativePanel, toolbar, state);
}
async function loadOptions(index) {
  if (busy || pending || !slip?.selections[index]) return;
  busy = true; message('Loading available outcomes from SportyBet…');
  try {
    const pick = slip.selections[index];
    const data = await api('/api/miniapp/code-options', { eventId: pick.eventId, sport: pick.sport });
    optionsIndex = index; options = data.options || [];
    render(); message(`${options.length} current outcomes · checked ${data.checkedAt}. ${data.truncated ? 'More markets exist beyond this list.' : ''}`);
  } catch (error) { message(error instanceof Error ? error.message : 'Market search failed.', true); }
  finally { busy = false; }
}
async function edit(action, extra = {}) {
  if (busy || !slip?.selections?.length) return;
  busy = true; message('Refreshing every market and requesting complete AI reanalysis…');
  try {
    const updated = await api('/api/miniapp/edit-slip', {
      action, ...extra, selections: slip.selections,
      analysisToken: slip.analysisToken, riskMode: slip.riskMode || 'balanced',
    });
    slip = { ...updated, sourceCode: slip.sourceCode };
    pending = false; optionsIndex = -1; options = [];
    render(); message(`${updated.selections.length} picks verified and reanalyzed. Combined odds: ${fmt(updated.combinedOdds)}. No bet placed.`);
  } catch (error) { message(error instanceof Error ? error.message : 'Reanalysis failed; edits are not approved.', true); }
  finally { busy = false; }
}
async function reanalyze() { await edit('reanalyze'); }
async function choose(index, option) {
  if (pending) { message('Reanalyze your existing removals first.', true); return; }
  await edit('choose', { index, marketId: option.marketId,
    selectionId: option.selectionId, specifier: option.specifier });
}
async function generate() {
  if (busy || pending || !slip?.analysisToken) return;
  busy = true; message('Refreshing odds before requesting the new code…');
  try {
    const data = { selections: slip.selections, analysisToken: slip.analysisToken };
    let result;
    try { result = await api('/api/miniapp/code', data); }
    catch (error) {
      if (error.status !== 409 || error.data?.status !== 'odds_changed') throw error;
      const yes = window.confirm(`Odds changed from ${fmt(error.data.previousOdds)} to ${fmt(error.data.currentOdds)}. Generate the new code with the updated odds?`);
      if (!yes) { message('Code generation cancelled. No bet placed.'); return; }
      result = await api('/api/miniapp/code', { ...data, acceptOddsChange: true });
    }
    panel.querySelector('.code-workspace-code')?.remove();
    const output = node('div', 'code-workspace-code');
    output.append(node('strong', '', 'Your NEW SportyBet booking code'),
      node('code', '', result.code), node('p', 'desk-note',
        `${result.selections} picks · current ${fmt(result.odds)} odds · no wager placed.`));
    output.append(button('Copy code', async () => {
      try { await navigator.clipboard.writeText(result.code); message('New code copied.'); }
      catch { window.prompt('Copy your new code:', result.code); }
    }));
    panel.append(output); message('A new code was created. Your original booking code remains unchanged.');
  } catch (error) { message(error instanceof Error ? error.message : 'Could not generate the new code.', true); }
  finally { busy = false; }
}
function saveToSlip() {
  if (busy || pending || !slip?.analysisToken) { message('Reanalyze edits before saving.', true); return; }
  let existing;
  try { existing = localStorage.getItem('aurex-active-slip'); }
  catch { message('Device storage is unavailable.', true); return; }
  if (existing && !window.confirm('Replace your current My Slip on this device with this imported and reviewed code?')) return;
  try {
    localStorage.setItem('aurex-active-slip', JSON.stringify(slip));
    localStorage.removeItem('aurex-slip-needs-analysis-v1');
    sessionStorage.setItem('aurex-return-to-slip', '1');
    window.location.reload();
  } catch { message('Could not save this slip. Your existing slip was not replaced.', true); }
}
document.addEventListener('aurex:code-workspace-clear', () => {
  slip = null; pending = false; optionsIndex = -1; options = []; panel.classList.add('hidden');
});
document.addEventListener('aurex:code-analyzed', (event) => {
  const imported = event.detail?.editableSlip;
  if (!imported?.selections?.length) return;
  slip = imported; pending = false; optionsIndex = -1; options = [];
  render(); message('Edit a particular market, remove picks or trim the combined odds.');
});
