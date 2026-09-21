// A pasted code stays in memory until explicitly moved to My Slip. Never store Telegram initData here.
const style = document.createElement('link');
style.rel = 'stylesheet'; style.href = '/app/code-workspace.css?v=5.4.1';
document.head.append(style);
const analysisResult = document.querySelector('#analysis-result');
const panel = document.createElement('section');
panel.className = 'desk-panel code-workspace hidden';
panel.setAttribute('aria-label', 'Edit and trim an analyzed booking code');
analysisResult?.after(panel);
let slip = null, pending = false, busy = false, optionsIndex = -1, options = [];
let maximumOdds = null;
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
function clearCode() { panel.querySelector('.code-workspace-code')?.remove(); }
// Remove whole legs, choosing the closest remaining odds at or below the maximum.
// Never fabricate a selection or promise an exact combined-odds match.
function trimTo(max) {
  const items = [...slip.selections];
  while (product(items) > max && items.length > 1) {
    const possibilities = items.map((_pick, i) => ({
      i, odds: product(items.filter((_item, j) => i !== j)),
    }));
    const withinLimit = possibilities.filter((item) => item.odds <= max)
      .sort((a, b) => b.odds - a.odds);
    const remove = withinLimit[0] || possibilities.sort((a, b) => a.odds - b.odds)[0];
    if (!remove) break;
    items.splice(remove.i, 1);
  }
  if (product(items) > max) return { ok: false, removed: 0 };
  const removed = slip.selections.length - items.length;
  if (removed) {
    slip.selections = items; pending = true; optionsIndex = -1; options = [];
    clearCode(); render();
  }
  return { ok: true, removed };
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
    actions.append(button('Edit odds / market', () => void loadOptions(i), busy || pending),
      button('Remove', () => {
        if (busy) return;
        if (slip.selections.length < 2) { message('At least one pick must remain.', true); return; }
        slip.selections.splice(i, 1); pending = true; optionsIndex = -1; options = [];
        clearCode(); render(); message('Pick removed. Tap Generate to reanalyze and create a new code.');
      }, busy));
    row.append(label, actions); rows.append(row);
  });
  const form = node('form', 'code-workspace-trim');
  const label = node('label');
  label.append(node('span', '', 'Maximum combined odds for your NEW booking code'));
  const target = node('input'); target.type = 'number'; target.min = '1.01';
  target.step = 'any'; target.inputMode = 'decimal'; target.placeholder = 'Enter target odds, e.g. 40';
  target.required = true; target.value = maximumOdds === null ? '' : String(maximumOdds);
  target.setAttribute('aria-label', 'Maximum combined odds'); label.append(target);
  const trim = node('button', '', 'Trim & generate NEW code'); trim.type = 'submit'; trim.disabled = busy;
  form.append(label, trim, node('p', 'desk-note',
    'One tap: trim whole picks, recheck live markets and AI quality, then request your new SportyBet code. Exact odds are not guaranteed; no bet is placed.'));
  form.addEventListener('submit', (event) => {
    event.preventDefault(); if (busy) return;
    const max = Number(target.value);
    if (!target.value.trim() || !Number.isFinite(max) || max < 1.01 || max > 1_000_000_000) {
      message('Enter valid target odds between 1.01 and 1,000,000,000.', true); return;
    }
    maximumOdds = max;
    const result = trimTo(max);
    if (!result.ok) {
      message(`The last remaining pick exceeds ${fmt(max)} odds. Choose a higher target or a lower-priced active market. No code was created.`, true);
      return;
    }
    message(result.removed
      ? `Removed ${result.removed} pick(s). Reanalyzing ${fmt(product(slip.selections))} odds and generating a new code…`
      : 'This slip already meets your target. Reanalyzing live odds and generating a new code…');
    void generate(true);
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
        () => void choose(optionsIndex, item), busy || pending));
    });
    alternativePanel.append(button('Close choices', () => { optionsIndex = -1; render(); }));
  }
  const toolbar = node('div', 'code-workspace-toolbar');
  toolbar.append(button(pending ? 'Reanalyze changes' : 'Refresh analysis', () => void reanalyze(), busy),
    button(pending ? 'Reanalyze & generate code' : 'Generate NEW booking code',
      () => void generate(), busy),
    button('Move to My Slip', () => saveToSlip(), busy || pending));
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
  if (busy || !slip?.selections?.length) return false;
  busy = true; message('Refreshing every market and requesting complete AI reanalysis…');
  try {
    const updated = await api('/api/miniapp/edit-slip', {
      action, ...extra, selections: slip.selections,
      analysisToken: slip.analysisToken, riskMode: slip.riskMode || 'balanced',
    });
    slip = { ...updated, sourceCode: slip.sourceCode };
    pending = false; optionsIndex = -1; options = [];
    clearCode(); render();
    message(`${updated.selections.length} picks verified and reanalyzed. Combined odds: ${fmt(updated.combinedOdds)}. No bet placed.`);
    return true;
  } catch (error) {
    message(error instanceof Error ? error.message : 'Reanalysis failed; no new code was created.', true);
    return false;
  } finally { busy = false; }
}
async function reanalyze() { await edit('reanalyze'); }
async function choose(index, option) {
  if (pending) { message('Reanalyze your existing removals first.', true); return; }
  await edit('choose', { index, marketId: option.marketId,
    selectionId: option.selectionId, specifier: option.specifier });
}
async function generate(refresh = false) {
  if (busy || !slip?.analysisToken) return;
  if ((pending || refresh) && !await edit('reanalyze')) return;
  // A provider may have changed the odds during reanalysis. Trim and verify again,
  // rather than silently creating a code above the requested maximum.
  if (maximumOdds !== null) {
    let rounds = 0;
    while (product(slip.selections) > maximumOdds && rounds < 60) {
      const result = trimTo(maximumOdds);
      if (!result.ok || !result.removed) {
        message(`Live odds exceed your ${fmt(maximumOdds)} maximum. Change the target or select a lower-priced active market. No code was created.`, true);
        return;
      }
      rounds += 1;
      message(`Live odds increased. Removed ${result.removed} more pick(s); rechecking before generating…`);
      if (!await edit('reanalyze')) return;
    }
    if (product(slip.selections) > maximumOdds) {
      message('Could not meet your maximum with verified live markets. No code was created.', true);
      return;
    }
  }
  busy = true; message('All remaining picks passed review. Refreshing final odds and requesting the new code…');
  try {
    const data = { selections: slip.selections, analysisToken: slip.analysisToken,
      ...(maximumOdds === null ? {} : { maximumOdds }) };
    let result;
    try { result = await api('/api/miniapp/code', data); }
    catch (error) {
      if (error.status !== 409 || error.data?.status !== 'odds_changed') throw error;
      if (maximumOdds !== null && error.data.currentOdds > maximumOdds) {
        throw new Error(`Final live odds are ${fmt(error.data.currentOdds)}, above your ${fmt(maximumOdds)} maximum. Trim again or choose another target. No code was created.`);
      }
      const yes = window.confirm(`Odds changed from ${fmt(error.data.previousOdds)} to ${fmt(error.data.currentOdds)}. Generate the new code with the updated odds?`);
      if (!yes) { message('Code generation cancelled. No bet placed.'); return; }
      result = await api('/api/miniapp/code', { ...data, acceptOddsChange: true });
    }
    clearCode();
    const output = node('div', 'code-workspace-code');
    output.setAttribute('role', 'status');
    output.append(node('strong', '', 'Your NEW SportyBet booking code'),
      node('code', '', result.code), node('p', 'desk-note',
        `${result.selections} picks · current ${fmt(result.odds)} odds${maximumOdds === null ? '' : ` · maximum ${fmt(maximumOdds)}`} · no wager placed.`));
    output.append(button('Copy code', async () => {
      try { await navigator.clipboard.writeText(result.code); message('New code copied.'); }
      catch { window.prompt('Copy your new code:', result.code); }
    }));
    panel.append(output); message('Your new code is ready below. The original booking code is unchanged.');
    output.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
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
  slip = null; pending = false; busy = false; maximumOdds = null;
  optionsIndex = -1; options = []; panel.classList.add('hidden');
});
document.addEventListener('aurex:code-analyzed', (event) => {
  const imported = event.detail?.editableSlip;
  if (!imported?.selections?.length) return;
  slip = imported; pending = false; busy = false; maximumOdds = null;
  optionsIndex = -1; options = [];
  render(); message('Enter your maximum odds and tap Trim & generate NEW code.');
});
