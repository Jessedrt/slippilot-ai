// Imported-code editing is intentionally ephemeral until the user explicitly saves to My Slip.
// Never cache Telegram initData, signed tokens or unconfirmed edits in history.
const workspaceStyle = document.createElement('link');
workspaceStyle.rel = 'stylesheet';
workspaceStyle.href = '/app/code-workspace.css?v=5.4.0';
document.head.append(workspaceStyle);
const workspaceResult = document.querySelector('#analysis-result');
const workspacePanel = document.createElement('section');
workspacePanel.className = 'desk-panel code-workspace hidden';
workspacePanel.setAttribute('aria-label', 'Edit and trim an analyzed booking code');
workspaceResult?.after(workspacePanel);
let codeSlip = null;
let dirtyCode = false;
let codeBusy = false;
let optionsIndex = -1;
let optionsList = [];
const wNode = (tag, className = '', value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
};
const wOdds = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
const wCombined = (selections) => selections.reduce((odds, item) => odds * item.odds, 1);
const wStatus = wNode('p', 'code-workspace-status');
wStatus.setAttribute('role', 'status');
wStatus.setAttribute('aria-live', 'polite');
function report(message, error = false) {
  wStatus.textContent = message;
  wStatus.dataset.kind = error ? 'error' : 'info';
}
async function callWorkspace(path, body) {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) throw new Error('Open AUREX through the Telegram launcher to edit a real booking code.');
  let response;
  try {
    response = await fetch(path, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify(body), signal: AbortSignal.timeout(55_000) });
  } catch { throw new Error('Provider request timed out or connection failed. No bet was placed.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'The provider request failed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
function makeButton(text, callback, disabled = false) {
  const button = wNode('button', '', text);
  button.type = 'button'; button.disabled = disabled || codeBusy;
  button.addEventListener('click', callback);
  return button;
}
function renderCodeWorkspace() {
  if (!workspaceResult || !codeSlip?.selections?.length) {
    workspacePanel.classList.add('hidden');
    return;
  }
  workspacePanel.classList.remove('hidden');
  workspacePanel.replaceChildren();
  const title = wNode('div', 'desk-heading');
  const info = wNode('div');
  info.append(wNode('p', 'eyebrow', 'VERIFIED BOOKING-CODE WORKSPACE'),
    wNode('h3', '', 'Edit & trim your code'));
  const original = wNode('p', 'desk-note',
    `Original: ${codeSlip.sourceCode || 'Imported code'} · ${codeSlip.selections.length} editable selections. Changes do not modify your original booking code.`);
  title.append(info, wNode('strong', 'code-workspace-odds', `${wOdds(wCombined(codeSlip.selections))} odds`));
  const summary = wNode('p', 'desk-note', codeSlip.summary || 'AI review completed.');
  const rows = wNode('div', 'code-workspace-list');
  codeSlip.selections.forEach((pick, index) => {
    const row = wNode('article', 'code-workspace-row');
    const details = wNode('div');
    details.append(wNode('strong', '', `${index + 1}. ${pick.homeTeam} vs ${pick.awayTeam}`),
      wNode('small', '', `${pick.marketName} · ${pick.selectionName} @ ${wOdds(pick.odds)} · ${pick.risk} risk`));
    const actions = wNode('div', 'code-workspace-actions');
    actions.append(makeButton('Edit odds / market', () => void showOptions(index), dirtyCode),
      makeButton('Remove', () => {
        if (codeSlip.selections.length < 2) { report('At least one selection must remain.', true); return; }
        codeSlip.selections.splice(index, 1);
        dirtyCode = true; optionsIndex = -1;
        renderCodeWorkspace();
        report('Selection removed. Reanalyze to approve the remaining markets before generating a new code.');
      }));
    row.append(details, actions); rows.append(row);
  });
  const trimForm = wNode('form', 'code-workspace-trim');
  const targetLabel = wNode('label');
  targetLabel.append(wNode('span', '', 'Trim down to combined odds (approximate)'));
  const target = wNode('input');
  target.type = 'number'; target.step = '0.01'; target.min = '1.01';
  target.placeholder = 'e.g. 5 or 10'; target.required = true;
  target.setAttribute('aria-label', 'Maximum target combined odds');
  targetLabel.append(target);
  const trim = wNode('button', '', 'Trim selections'); trim.type = 'submit'; trim.disabled = codeBusy;
  trimForm.append(targetLabel, trim, wNode('p', 'desk-note',
    'Trimming removes whole selections; it cannot guarantee an exact target. Review which games remain before reanalysis.'));
  trimForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const maximum = Number(target.value);
    if (!Number.isFinite(maximum) || maximum < 1.01) { report('Enter a valid target of at least 1.01.', true); return; }
    let remaining = [...codeSlip.selections];
    if (wCombined(remaining) <= maximum) { report('The slip is already at or below that target. No picks were removed.'); return; }
    while (wCombined(remaining) > maximum && remaining.length > 1) {
      const combinations = remaining.map((_pick, index) => ({ index,
        product: wCombined(remaining.filter((_item, position) => position !== index)) }));
      const within = combinations.filter((item) => item.product <= maximum)
        .sort((a, b) => b.product - a.product);
      const choice = within[0] || combinations.sort((a, b) => a.product - b.product)[0];
      if (!choice) break;
      remaining.splice(choice.index, 1);
    }
    if (wCombined(remaining) > maximum) {
      report(`Even the last selection exceeds ${wOdds(maximum)} odds. Use Edit odds / market to choose a lower-priced verified option.`, true);
      return;
    }
    const removed = codeSlip.selections.length - remaining.length;
    codeSlip.selections = remaining; dirtyCode = true; optionsIndex = -1;
    renderCodeWorkspace();
    report(`Removed ${removed} selection(s). Current estimate: ${wOdds(wCombined(remaining))} odds versus ${wOdds(maximum)} target. Review and tap Reanalyze.`);
  });
  const tools = wNode('div', 'code-workspace-toolbar');
  tools.append(makeButton(dirtyCode ? 'Reanalyze changes' : 'Refresh analysis', () => void reanalyzeCode(), false),
    makeButton('Generate NEW booking code', () => void generateEditedCode(), dirtyCode),
    makeButton('Move to My Slip', () => saveAsActive(), dirtyCode));
  const options = wNode('div', 'code-workspace-options');
  if (optionsIndex >= 0) {
    options.append(wNode('h4', '', 'Choose the exact provider market and odds'));
    options.append(wNode('p', 'desk-note',
      'Prices are current supplier snapshots, not recommendations. Selecting an outcome reanalyzes the full code.'));
    if (!optionsList.length) options.append(wNode('p', 'desk-empty', 'No eligible replacement outcomes were returned.'));
    optionsList.forEach((item) => {
      const selected = codeSlip.selections[optionsIndex];
      if (selected?.marketId === item.marketId && selected?.selectionId === item.selectionId &&
          (selected?.specifier ?? null) === item.specifier) return;
      options.append(makeButton(`${item.marketName} · ${item.selectionName} @ ${wOdds(item.odds)}`,
        () => void chooseMarket(optionsIndex, item), dirtyCode));
    });
    options.append(makeButton('Close market choices', () => { optionsIndex = -1; renderCodeWorkspace(); }));
  }
  workspacePanel.append(title, original, summary, rows, trimForm, options, tools, wStatus);
}
async function showOptions(index) {
  if (codeBusy || dirtyCode || !codeSlip.selections[index]) return;
  codeBusy = true;
  report('Loading active provider markets for this fixture…');
  try {
    const pick = codeSlip.selections[index];
    const response = await callWorkspace('/api/miniapp/code-options', {
      eventId: pick.eventId, sport: pick.sport });
    optionsIndex = index; optionsList = response.options || [];
    renderCodeWorkspace();
    report(`${optionsList.length} options · ${response.source} · checked ${response.checkedAt}. ${response.truncated ? 'More markets exist; this list is limited.' : ''}`);
  } catch (error) { report(error instanceof Error ? error.message : 'Market list unavailable.', true); }
  finally { codeBusy = false; }
}
async function reanalyzeCode() {
  if (codeBusy || !codeSlip?.selections?.length) return;
  codeBusy = true; report('Refreshing the remaining markets and reanalyzing every selection…');
  try {
    const updated = await callWorkspace('/api/miniapp/edit-slip', {
      action: 'reanalyze', selections: codeSlip.selections,
      analysisToken: codeSlip.analysisToken, riskMode: codeSlip.riskMode || 'balanced',
    });
    codeSlip = { ...updated, sourceCode: codeSlip.sourceCode };
    dirtyCode = false; optionsIndex = -1; optionsList = [];
    renderCodeWorkspace(); report(`Reanalysis complete. ${updated.selections.length} picks · ${wOdds(updated.combinedOdds)} odds. No bet was placed.`);
  } catch (error) { report(error instanceof Error ? error.message : 'Reanalysis failed; do not generate a code.', true); }
  finally { codeBusy = false; }
}
async function chooseMarket(index, option) {
  if (codeBusy || dirtyCode || !codeSlip?.selections?.[index]) return;
  codeBusy = true; report('Verifying your chosen market and reanalyzing the complete slip…');
  try {
    const updated = await callWorkspace('/api/miniapp/edit-slip', {
      action: 'choose', index, marketId: option.marketId,
      selectionId: option.selectionId, specifier: option.specifier,
      selections: codeSlip.selections, analysisToken: codeSlip.analysisToken,
      riskMode: codeSlip.riskMode || 'balanced',
    });
    codeSlip = { ...updated, sourceCode: codeSlip.sourceCode };
    dirtyCode = false; optionsIndex = -1; optionsList = [];
    renderCodeWorkspace(); report(`Chosen market independently verified and reanalyzed. New combined odds: ${wOdds(updated.combinedOdds)}.`);
  } catch (error) { report(error instanceof Error ? error.message : 'Could not change that market.', true); }
  finally { codeBusy = false; }
}
async function generateEditedCode() {
  if (codeBusy || dirtyCode || !codeSlip?.analysisToken) return;
  codeBusy = true; report('Validating every market and requesting a new SportyBet code…');
  try {
    let result;
    const body = { selections: codeSlip.selections, analysisToken: codeSlip.analysisToken };
    try { result = await callWorkspace('/api/miniapp/code', body); }
    catch (error) {
      if (error.status !== 409 || error.data?.status !== 'odds_changed') throw error;
      if (!window.confirm(`Provider odds changed from ${wOdds(error.data.previousOdds)} to ${wOdds(error.data.currentOdds)}. Generate the NEW code at current odds?`)) {
        report('Code generation cancelled. No wager was placed.'); return;
      }
      result = await callWorkspace('/api/miniapp/code', { ...body, acceptOddsChange: true });
    }
    const codeBox = wNode('div', 'code-workspace-code');
    codeBox.append(wNode('strong', '', 'New SportyBet code'), wNode('code', '', result.code),
      wNode('p', 'desk-note', `${result.selections} selections · ${wOdds(result.odds)} current odds. No wager was placed.`));
    codeBox.append(makeButton('Copy new code', async () => {
      try { await navigator.clipboard.writeText(result.code); report('New code copied.'); }
      catch { window.prompt('Copy your new booking code:', result.code); }
    }));
    workspacePanel.querySelector('.code-workspace-code')?.remove();
    workspacePanel.append(codeBox);
    report('Your NEW booking code is ready. The original code was not modified.');
  } catch (error) { report(error instanceof Error ? error.message : 'Could not create the new code.', true); }
  finally { codeBusy = false; }
}
function saveAsActive() {
  if (dirtyCode || !codeSlip?.analysisToken) { report('Reanalyze edits first.', true); return; }
  let existing;
  try { existing = localStorage.getItem('aurex-active-slip'); }
  catch { report('Browser storage is unavailable; could not open My Slip.', true); return; }
  if (existing && !window.confirm('Replace the active My Slip on this device with the verified imported code?')) return;
  try {
    localStorage.setItem('aurex-active-slip', JSON.stringify(codeSlip));
    localStorage.removeItem('aurex-slip-needs-analysis-v1');
    sessionStorage.setItem('aurex-return-to-slip', '1');
    window.location.reload();
  } catch { report('Could not save the imported slip. It has not replaced My Slip.', true); }
}
document.addEventListener('aurex:code-workspace-clear', () => {
  codeSlip = null; dirtyCode = false; optionsIndex = -1;
  optionsList = []; workspacePanel.classList.add('hidden');
});
document.addEventListener('aurex:code-analyzed', (event) => {
  if (!event.detail?.editableSlip?.selections?.length) return;
  codeSlip = event.detail.editableSlip;
  dirtyCode = false; optionsIndex = -1; optionsList = [];
  renderCodeWorkspace();
  report('Select Edit odds / market for a particular game, Remove a game, or Trim to target odds.');
});
