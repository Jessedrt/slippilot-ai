// Imported booking codes stay in memory until explicitly saved. Never persist Telegram initData.
const style = document.createElement('link');
style.rel = 'stylesheet'; style.href = '/app/code-workspace.css?v=6.2.0';
document.head.append(style);
const analysisResult = document.querySelector('#analysis-result');
const panel = document.createElement('section');
panel.className = 'desk-panel code-workspace hidden';
panel.setAttribute('aria-label', 'Score-ranked booking code editor');
analysisResult?.after(panel);
const { rankByScore, selectForTarget, combinedOdds: product } = window.AurexScoreTrim;
let slip = null, pending = false, busy = false, optionsIndex = -1, options = [];
let maximumOdds = null;
const node = (tag, cls = '', text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = String(text);
  return el;
};
const fmt = (n) => Number.isFinite(Number(n)) ? Number(n).toFixed(2) : '—';
const state = node('p', 'code-workspace-status');
state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
function message(text, warning = false) {
  state.textContent = text; state.dataset.kind = warning ? 'error' : 'info';
}
async function api(path, body) {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) throw new Error('Open the AUREX Mini App from Telegram for verified editing.');
  let response;
  try {
    response = await fetch(path, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify(body), signal: AbortSignal.timeout(55_000) });
  } catch { throw new Error('Provider unavailable or request timed out. No bet was placed.'); }
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
// Preserve the higher signed minimum if an earlier edit used the strict 2/5 preset.
const scoreMinimum = (target) => Math.max(Number(slip.qualityMinimum) || 55,
  target === 2 || target === 5 ? 68 : 55);
// Choose only provider-backed whole legs in descending evidence-quality order.
function trimTo(target) {
  const minimum = scoreMinimum(target);
  const eligible = slip.selections.filter((pick) => pick.confidence >= minimum);
  const result = selectForTarget(eligible, target);
  if (!result.ok) return { ...result, minimum };
  const removed = slip.selections.length - result.selections.length;
  slip.selections = result.selections;
  if (removed) {
    pending = true; optionsIndex = -1; options = [];
    clearCode();
  }
  render();
  return { ...result, removed, minimum };
}
function render() {
  if (!analysisResult || !slip?.selections?.length) { panel.classList.add('hidden'); return; }
  slip.selections = rankByScore(slip.selections);
  panel.classList.remove('hidden'); panel.replaceChildren();
  const heading = node('div', 'desk-heading'), headingText = node('div');
  headingText.append(node('p', 'eyebrow', 'SCORE-RANKED CODE WORKSPACE'),
    node('h3', '', 'Analyze · rank · trim'));
  heading.append(headingText, node('strong', 'code-workspace-odds', `${fmt(product(slip.selections))} odds`));
  const intro = node('p', 'desk-note',
    `Original code: ${slip.sourceCode || 'Imported'} · ${slip.selections.length} eligible picks. Ranked by AI evidence-quality score, highest first—not win probability.`);
  const summary = node('p', 'desk-note', slip.summary || 'AI review completed.');
  const rows = node('div', 'code-workspace-list');
  slip.selections.forEach((pick, i) => {
    const row = node('article', 'code-workspace-row');
    const label = node('div');
    label.append(node('strong', '', `${i + 1}. ${pick.homeTeam} vs ${pick.awayTeam}`),
      node('small', '', `${pick.marketName} · ${pick.selectionName} @ ${fmt(pick.odds)} · ${pick.risk} risk`),
      node('span', 'code-workspace-score', `AI quality: ${Math.round(pick.confidence)}/100 · Rank #${i + 1}`));
    const actions = node('div', 'code-workspace-actions');
    actions.append(button('Edit odds / market', () => void loadOptions(i), busy || pending),
      button('Remove', () => {
        if (busy) return;
        if (slip.selections.length < 2) { message('At least one pick must remain.', true); return; }
        slip.selections.splice(i, 1); pending = true; optionsIndex = -1; options = [];
        clearCode(); render(); message('Pick removed. Your remaining games stay ordered by score. Generate to reanalyze.');
      }, busy));
    row.append(label, actions); rows.append(row);
  });
  const form = node('form', 'code-workspace-trim');
  const label = node('label');
  label.append(node('span', '', 'Your target combined odds · enter any valid value'));
  const target = node('input'); target.type = 'number'; target.min = '1.01';
  target.step = 'any'; target.inputMode = 'decimal';
  target.placeholder = 'e.g. 2, 5, 10, 25 or 100';
  target.required = true; target.value = maximumOdds === null ? '' : String(maximumOdds);
  target.setAttribute('aria-label', 'Your target combined odds'); label.append(target);
  const trim = node('button', '', 'Rank, trim & generate code'); trim.type = 'submit'; trim.disabled = busy;
  form.append(label, trim, node('p', 'desk-note',
    'Keeps eligible higher-scored games first and skips picks that exceed your target. The 2.00/5.00 presets require a 68/100 AI quality score. Only imported games are used; exact odds are not guaranteed.'));
  form.addEventListener('submit', (event) => {
    event.preventDefault(); if (busy) return;
    const targetOdds = Number(target.value);
    if (!target.value.trim() || !Number.isFinite(targetOdds) || targetOdds < 1.01 || targetOdds > 1_000_000_000) {
      message('Enter valid decimal odds between 1.01 and 1,000,000,000. There is no 40-odds preset.', true);
      return;
    }
    maximumOdds = targetOdds;
    const result = trimTo(targetOdds);
    if (!result.ok) {
      message(`No eligible game with a score of at least ${result.minimum}/100 fits ${fmt(targetOdds)} odds. Choose another target or edit an active market. No code was created.`, true);
      return;
    }
    message(result.removed
      ? `Kept ${result.selections.length} higher-scored picks; removed ${result.removed}. Verifying live odds and creating your code…`
      : `All ${result.selections.length} picks fit ${fmt(targetOdds)} odds. Checking live markets and creating your code…`);
    void generate(true);
  });
  const alternativePanel = node('div', 'code-workspace-options');
  if (optionsIndex >= 0) {
    alternativePanel.append(node('h4', '', 'Choose a specific active market'),
      node('p', 'desk-note', 'These are SportyBet snapshots, not AI recommendations. Reanalysis updates the ranking.'));
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
    message(`${options.length} current outcomes · checked ${data.checkedAt}. ${data.truncated ? 'Additional markets exist.' : ''}`);
  } catch (error) { message(error instanceof Error ? error.message : 'Market search failed.', true); }
  finally { busy = false; render(); }
}
async function edit(action, extra = {}) {
  if (busy || !slip?.selections?.length) return false;
  busy = true; message('Refreshing every market and requesting complete AI reanalysis…');
  try {
    const updated = await api('/api/miniapp/edit-slip', {
      action, ...extra, selections: slip.selections,
      analysisToken: slip.analysisToken, riskMode: slip.riskMode || 'balanced',
      ...(maximumOdds === null ? {} : { targetOdds: maximumOdds }),
    });
    slip = { ...updated, selections: rankByScore(updated.selections), sourceCode: slip.sourceCode };
    pending = false; optionsIndex = -1; options = [];
    clearCode();
    message(`${updated.selections.length} games reanalyzed and ranked by quality. Combined odds: ${fmt(updated.combinedOdds)}. AI quality minimum: ${updated.qualityMinimum}/100.`);
    return true;
  } catch (error) {
    message(error instanceof Error ? error.message : 'Reanalysis failed; no new code was created.', true);
    return false;
  } finally { busy = false; render(); }
}
async function reanalyze() { await edit('reanalyze'); }
async function choose(index, option) {
  if (pending) { message('Reanalyze your removals before editing another market.', true); return; }
  await edit('choose', { index, marketId: option.marketId,
    selectionId: option.selectionId, specifier: option.specifier });
}
async function generate(refresh = false) {
  if (busy || !slip?.analysisToken) return;
  if ((pending || refresh) && !await edit('reanalyze')) return;
  // Odds move between reviews. Repeat rank/trim and review against live market prices;
  // never silently generate a code above the requested target.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (maximumOdds !== null && product(slip.selections) > maximumOdds + 0.000001) {
      const result = trimTo(maximumOdds);
      if (!result.ok || !result.removed) {
        message(`No eligible games fit your ${fmt(maximumOdds)} target at these odds. Edit a market or change your target. No code was created.`, true);
        return;
      }
      message(`Live odds changed. Kept ${result.selections.length} higher-scored games; refreshing analysis…`);
      if (!await edit('reanalyze')) return;
      if (product(slip.selections) > maximumOdds + 0.000001) continue;
    }
    busy = true; message('Score-ranked selections verified. Refreshing final odds and requesting the code…');
    let retry = false;
    try {
      const data = { selections: rankByScore(slip.selections), analysisToken: slip.analysisToken,
        ...(maximumOdds === null ? {} : { maximumOdds }) };
      let result;
      try { result = await api('/api/miniapp/code', data); }
      catch (error) {
        if (error.status === 409 && error.data?.status === 'target_exceeded' && maximumOdds !== null) {
          retry = true;
        } else if (error.status === 409 && error.data?.status === 'odds_changed') {
          if (maximumOdds !== null && error.data.currentOdds > maximumOdds + 0.000001) retry = true;
          else {
            const yes = window.confirm(`Odds changed from ${fmt(error.data.previousOdds)} to ${fmt(error.data.currentOdds)}. Generate with the updated odds?`);
            if (!yes) { message('Code generation cancelled. No bet placed.'); return; }
            result = await api('/api/miniapp/code', { ...data, acceptOddsChange: true });
          }
        } else throw error;
      }
      if (!retry) {
        clearCode();
        const output = node('div', 'code-workspace-code'); output.setAttribute('role', 'status');
        output.append(node('strong', '', 'Your NEW SportyBet booking code'),
          node('code', '', result.code), node('p', 'desk-note',
            `${result.selections} score-ranked picks · current ${fmt(result.odds)} odds${maximumOdds === null ? '' : ` · target ${fmt(maximumOdds)}`} · no wager placed.`));
        output.append(button('Copy code', async () => {
          try { await navigator.clipboard.writeText(result.code); message('New code copied.'); }
          catch { window.prompt('Copy your new code:', result.code); }
        }));
        panel.append(output); message('Your score-ranked code is ready below. The original code is unchanged.');
        output.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        return;
      }
    } catch (error) {
      message(error instanceof Error ? error.message : 'Could not generate a new code.', true);
      return;
    } finally { busy = false; }
    message('SportyBet prices rose beyond your target. Rechecking and trimming lower-scored picks…');
    if (!await edit('reanalyze')) return;
  }
  message('SportyBet odds changed repeatedly. Your target could not be met reliably; no code was created. Retry with fresh prices.', true);
}
function saveToSlip() {
  if (busy || pending || !slip?.analysisToken) { message('Reanalyze edits before saving.', true); return; }
  let existing;
  try { existing = localStorage.getItem('aurex-active-slip'); }
  catch { message('Device storage is unavailable.', true); return; }
  if (existing && !window.confirm('Replace your current My Slip with this reviewed code?')) return;
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
  slip = { ...imported, selections: rankByScore(imported.selections) };
  pending = false; busy = false; maximumOdds = null;
  optionsIndex = -1; options = [];
  render(); message('Games are ranked by analysis score. Enter ANY valid odds target to trim and generate a code.');
});
