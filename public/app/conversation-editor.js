// Conversational editor for verified imported slips. Uses AUREX's own signed analysis
// tokens and SportyBet provider endpoints; never fabricates selections or booking codes.
const chatStyle = document.createElement('link');
chatStyle.rel = 'stylesheet';
chatStyle.href = '/app/conversation-editor.css?v=7.0.0';
document.head.append(chatStyle);
const analysisPanel = document.querySelector('#analysis-result');
const manualWorkspace = document.querySelector('.code-workspace');
const chat = document.createElement('section');
chat.className = 'aurex-conversation hidden';
chat.setAttribute('aria-label', 'Conversational booking-code editor');
analysisPanel?.after(chat);
const { parse, splitEven } = globalThis.AurexChatCommands;
const { rankByScore, selectForTarget, combinedOdds } = globalThis.AurexScoreTrim;
let slip = null;
let desiredOdds = null;
let pending = false;
let busy = false;
let modified = false;
let mode = 'chat';
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
};
const fmt = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—';
const header = make('div', 'aurex-conversation-heading');
const headingText = make('div');
headingText.append(make('p', 'eyebrow', 'TICKET EDITOR · CHAT'), make('h3', '', 'Tell Aurex what to change'));
const manual = make('button', 'aurex-manual-toggle', 'Manual editor');
manual.type = 'button';
header.append(headingText, manual);
const introduction = make('p', 'aurex-chat-note',
  'Your verified games stay in memory. Edit by message, inspect live alternatives and generate actual SportyBet codes. No wager is placed.');
const transcript = make('div', 'aurex-chat-transcript');
transcript.setAttribute('role', 'log');
transcript.setAttribute('aria-live', 'polite');
const examples = make('div', 'aurex-chat-examples');
const form = make('form', 'aurex-chat-form');
const input = make('input');
input.type = 'text'; input.maxLength = 180;
input.placeholder = 'e.g. Change game 2 to over 1.5';
input.setAttribute('aria-label', 'Tell Aurex how to edit your booking code');
input.required = true;
const send = make('button', '', 'Send');
send.type = 'submit';
form.append(input, send);
const smallPrint = make('p', 'aurex-chat-note',
  'Scores describe AI evidence quality, not win probabilities. Exact requested odds and successful outcomes are not guaranteed.');
chat.append(header, introduction, transcript, examples, form, smallPrint);
function setBusy(value) {
  busy = value;
  send.disabled = value;
  input.disabled = value;
  send.textContent = value ? 'Working…' : 'Send';
}
function bubble(role, text) {
  const entry = make('div', `aurex-chat-bubble aurex-chat-${role}`);
  entry.append(make('span', 'aurex-chat-speaker', role === 'you' ? 'You' : 'Aurex'),
    make('p', '', text));
  transcript.append(entry);
  while (transcript.children.length > 48) transcript.firstElementChild?.remove();
  transcript.scrollTop = transcript.scrollHeight;
  return entry;
}
function actionButton(parent, label, handler) {
  const element = make('button', 'aurex-chat-action', label);
  element.type = 'button';
  element.addEventListener('click', () => { if (!busy) void handler(); });
  parent.append(element);
  return element;
}
function showCode(code, odds, count, label = 'New SportyBet code') {
  const entry = bubble('bot', `${label}: ${count} verified selections · ${fmt(odds)} current odds. No bet placed.`);
  entry.append(make('code', 'aurex-chat-code', code));
  actionButton(entry, 'Copy code', async () => {
    try { await navigator.clipboard.writeText(code); bubble('bot', 'Code copied.'); }
    catch { window.prompt('Copy the code:', code); }
  });
}
function oddsMinimum() {
  return Math.max(Number(slip?.qualityMinimum) || 55,
    desiredOdds === 2 || desiredOdds === 5 ? 68 : 55);
}
function snapshot() {
  if (!slip?.selections?.length) throw new Error('Import a booking code first.');
  return rankByScore(slip.selections);
}
function describe() {
  const items = snapshot();
  const lines = items.map((pick, index) =>
    `${index + 1}. ${pick.homeTeam} vs ${pick.awayTeam} — ${pick.selectionName} @ ${fmt(pick.odds)} · AI quality ${Math.round(pick.confidence)}/100`);
  bubble('bot', `${items.length} eligible games · ${fmt(combinedOdds(items))} current combined odds. Highest evidence score first:\n${lines.join('\n')}`);
}
async function api(path, body) {
  const initData = window.Telegram?.WebApp?.initData;
  if (!initData) throw new Error('Open Aurex from its Telegram Mini App launcher to edit verified codes.');
  let response;
  try {
    response = await fetch(path, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
      body: JSON.stringify(body), signal: AbortSignal.timeout(55_000) });
  } catch { throw new Error('Provider connection failed or timed out. No code was made and no bet was placed.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Provider could not complete this edit.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
function refreshSession(next) {
  slip = { ...next, selections: rankByScore(next.selections), sourceCode: slip?.sourceCode || next.sourceCode };
  pending = false;
}
async function reanalyze() {
  const current = snapshot();
  const updated = await api('/api/miniapp/edit-slip', {
    action: 'reanalyze', selections: current,
    analysisToken: slip.analysisToken, riskMode: slip.riskMode || 'balanced',
    ...(desiredOdds === null ? {} : { targetOdds: desiredOdds }),
  });
  refreshSession(updated);
  return updated;
}
function trimSelection(target) {
  const eligible = snapshot().filter((pick) => pick.confidence >= oddsMinimum());
  const chosen = selectForTarget(eligible, target);
  if (!chosen.ok) throw new Error(`No game with AI quality of at least ${oddsMinimum()}/100 fits ${fmt(target)} odds. Choose another target or edit a market.`);
  const removed = slip.selections.length - chosen.selections.length;
  slip.selections = chosen.selections;
  if (removed) { pending = true; modified = true; }
  return { ...chosen, removed };
}
async function generate() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (desiredOdds !== null) trimSelection(desiredOdds);
    await reanalyze(); // Always refresh real market prices and signed AI scores.
    if (desiredOdds !== null) {
      const afterRefresh = trimSelection(desiredOdds);
      if (afterRefresh.removed) await reanalyze();
    }
    try {
      const body = { selections: snapshot(), analysisToken: slip.analysisToken,
        ...(desiredOdds === null ? {} : { maximumOdds: desiredOdds }) };
      let result;
      try { result = await api('/api/miniapp/code', body); }
      catch (error) {
        if (error.status === 409 && error.data?.status === 'target_exceeded') continue;
        if (error.status !== 409 || error.data?.status !== 'odds_changed') throw error;
        if (desiredOdds !== null && error.data.currentOdds > desiredOdds + 0.000001) continue;
        if (!window.confirm(`Live odds changed from ${fmt(error.data.previousOdds)} to ${fmt(error.data.currentOdds)}. Generate with the updated odds?`)) {
          bubble('bot', 'Cancelled. Your working slip is unchanged; no code or wager was created.');
          return;
        }
        result = await api('/api/miniapp/code', { ...body, acceptOddsChange: true });
      }
      showCode(result.code, result.odds, result.selections);
      return;
    } catch (error) {
      if (error.status === 409 && error.data?.status === 'target_exceeded') continue;
      throw error;
    }
  }
  throw new Error('SportyBet odds kept moving above your target. No code was created; try again with fresh odds.');
}
function removeIndices(indices) {
  const current = snapshot();
  if (!indices.length || indices.some((i) => !Number.isInteger(i) || i < 0 || i >= current.length))
    throw new Error('Choose a valid game number from the current ranked slip.');
  if (current.length - new Set(indices).size < 1)
    throw new Error('At least one game must remain. Nothing was removed.');
  const removed = current.filter((_item, index) => indices.includes(index));
  slip.selections = current.filter((_item, index) => !indices.includes(index));
  pending = true; modified = true;
  bubble('bot', `Removed ${removed.length} game(s): ${removed.map((pick) => `${pick.homeTeam} vs ${pick.awayTeam}`).join('; ')}. ${slip.selections.length} remain. Ask for odds or type “Generate code” to reanalyze.`);
}
async function editMarket(index, desired) {
  const current = snapshot();
  if (!Number.isInteger(index) || index < 1 || index > current.length)
    throw new Error(`Pick a game from 1 to ${current.length}; type “Show games” to see the ranking.`);
  const original = current[index - 1];
  const markets = await api('/api/miniapp/code-options', {
    eventId: original.eventId, sport: original.sport,
  });
  const available = (markets.options || []).filter((item) =>
    !(item.marketId === original.marketId && item.selectionId === original.selectionId &&
      (item.specifier ?? null) === (original.specifier ?? null)));
  const query = desired.toLowerCase().replace(/\s+/g, ' ').trim();
  const matches = query ? available.filter((item) =>
    `${item.marketName} ${item.selectionName}`.toLowerCase().includes(query) ||
    item.selectionName.toLowerCase().includes(query)) : available;
  const display = query && !matches.length ? available : matches;
  if (!display.length) throw new Error('No other active SportyBet outcomes are available for this game.');
  const entry = bubble('bot', `${original.homeTeam} vs ${original.awayTeam}: ${matches.length ? 'choose an actual active alternative below' : 'no exact market match; refine your instruction or choose a listed alternative'}. A changed market must pass a fresh AI review.`);
  const choices = make('div', 'aurex-chat-options');
  for (const option of display.slice(0, 16)) {
    actionButton(choices, `${option.marketName} · ${option.selectionName} @ ${fmt(option.odds)}`, async () => {
      setBusy(true);
      try {
        // A removal may leave the client holding a signed superset; refresh it first.
        if (pending) await reanalyze();
        const position = snapshot().findIndex((pick) => pick.eventId === original.eventId &&
          pick.marketId === original.marketId && pick.selectionId === original.selectionId &&
          (pick.specifier ?? null) === (original.specifier ?? null));
        if (position < 0) throw new Error('This game changed. Ask to edit it again using its new ranking.');
        const updated = await api('/api/miniapp/edit-slip', {
          action: 'choose', index: position, selections: snapshot(),
          analysisToken: slip.analysisToken, riskMode: slip.riskMode || 'balanced',
          ...(desiredOdds === null ? {} : { targetOdds: desiredOdds }),
          marketId: option.marketId, selectionId: option.selectionId,
          specifier: option.specifier,
        });
        refreshSession(updated);
        modified = true;
        bubble('bot', `Changed and reanalyzed ${original.homeTeam} vs ${original.awayTeam}: ${option.marketName} · ${option.selectionName}. ${fmt(combinedOdds(slip.selections))} combined odds; games reordered by their fresh quality scores. Type “Generate code” when ready.`);
        choices.replaceChildren(make('span', '', 'Market change completed.'));
      } catch (error) { bubble('bot', error.message || 'Market change failed. No code created.'); }
      finally { setBusy(false); }
    });
  }
  if (display.length > 16) choices.append(make('p', 'aurex-chat-note',
    `${display.length - 16} more options exist. Specify the market and line to narrow the list.`));
  entry.append(choices);
  transcript.scrollTop = transcript.scrollHeight;
}
async function split(count) {
  if (!Number.isSafeInteger(count) || count < 2 || count > 6 || count > snapshot().length)
    throw new Error('Split into 2–6 parts, with at least one verified game per part.');
  await reanalyze();
  const groups = splitEven(snapshot(), count);
  if (!groups) throw new Error('This slip cannot be split into the requested number of parts.');
  bubble('bot', `Splitting ${slip.selections.length} reviewed games into ${count} non-overlapping slips, balancing size and combined odds. Checking each part with SportyBet…`);
  for (const [index, selections] of groups.entries()) {
    try {
      const body = { selections, analysisToken: slip.analysisToken };
      let result;
      try { result = await api('/api/miniapp/code', body); }
      catch (error) {
        if (error.status !== 409 || error.data?.status !== 'odds_changed') throw error;
        if (!window.confirm(`Part ${index + 1} odds changed to ${fmt(error.data.currentOdds)}. Generate with updated odds?`)) {
          bubble('bot', `Part ${index + 1} cancelled. No code was created for this part.`);
          continue;
        }
        result = await api('/api/miniapp/code', { ...body, acceptOddsChange: true });
      }
      showCode(result.code, result.odds, result.selections, `Part ${index + 1} of ${count}`);
    } catch (error) {
      bubble('bot', `Part ${index + 1} could not be generated: ${error.message}. No code for this part.`);
    }
  }
}
function saveToSlip() {
  if (pending) throw new Error('Reanalyze your changes before saving to My Slip.');
  if (!slip?.analysisToken) throw new Error('Analyze a code first.');
  let existing;
  try { existing = localStorage.getItem('aurex-active-slip'); }
  catch { throw new Error('Device storage is unavailable.'); }
  if (existing && !window.confirm('Replace the current My Slip on this device?')) return;
  localStorage.setItem('aurex-active-slip', JSON.stringify(slip));
  localStorage.removeItem('aurex-slip-needs-analysis-v1');
  sessionStorage.setItem('aurex-return-to-slip', '1');
  window.location.reload();
}
async function execute(text) {
  const command = parse(text);
  if (command.action === 'import') {
    const codeInput = document.querySelector('#read-code');
    const codeForm = document.querySelector('#read-code-form');
    codeInput.value = command.code;
    codeForm.requestSubmit();
    return;
  }
  if (!slip?.selections?.length) { bubble('bot', 'Paste a valid SportyBet booking code above and tap Analyze & edit code first.'); return; }
  if (command.action === 'help') {
    bubble('bot', 'Try: “Show games”, “Remove game 3”, “Remove 2 weakest”, “Trim to 10 odds”, “Change game 2 to over 1.5”, “Split into 2”, “Reanalyze”, or “Generate code”. For exact market changes, choose an available provider outcome. Other bookmaker conversions and combining different codes are not supported.');
    return;
  }
  if (command.action === 'unsupported') {
    bubble('bot', 'Aurex currently verifies and creates SportyBet codes only. Combining independently signed slips or converting to other bookmakers is not available, so I cannot generate a genuine code for those requests.');
    return;
  }
  if (command.action === 'list') { describe(); return; }
  if (command.action === 'remove') { removeIndices([command.index - 1]); return; }
  if (command.action === 'weakest') {
    if (!Number.isSafeInteger(command.count) || command.count < 1 || command.count >= snapshot().length)
      throw new Error('Choose a positive number of weakest games while leaving at least one game.');
    const weakest = snapshot().map((_pick, index) => index).slice(-command.count);
    removeIndices(weakest);
    return;
  }
  if (command.action === 'remove_name') {
    const name = command.name.toLowerCase();
    const matches = snapshot().flatMap((pick, index) =>
      `${pick.homeTeam} ${pick.awayTeam}`.toLowerCase().includes(name) ? [index] : []);
    if (matches.length !== 1) throw new Error(matches.length
      ? 'Several games match that name. Use “Remove game N” with its rank number.'
      : 'No game matches that name. Type “Show games” and use its number.');
    removeIndices(matches);
    return;
  }
  if (command.action === 'change') { await editMarket(command.index, command.requestedMarket); return; }
  if (command.action === 'target') {
    if (!Number.isFinite(command.target) || command.target < 1.01 || command.target > 1_000_000_000)
      throw new Error('Enter a valid odds target from 1.01 to 1,000,000,000.');
    desiredOdds = command.target;
    const result = trimSelection(desiredOdds);
    bubble('bot', `Target: ${fmt(desiredOdds)} odds. Kept ${result.selections.length} score-ranked games; removed ${result.removed}. Rechecking live markets and preparing your code…`);
    await generate();
    return;
  }
  if (command.action === 'reanalyze') {
    const updated = await reanalyze();
    bubble('bot', `Reviewed ${updated.selections.length} active games again. AI minimum: ${updated.qualityMinimum}/100; current odds ${fmt(updated.combinedOdds)}. Type “Show games” to see the refreshed score ranking.`);
    return;
  }
  if (command.action === 'split') { await split(command.count); return; }
  if (command.action === 'generate') { await generate(); return; }
}
async function submitMessage(text) {
  if (busy) return;
  const value = String(text).trim();
  if (!value) return;
  bubble('you', value);
  input.value = '';
  setBusy(true);
  try { await execute(value); }
  catch (error) { bubble('bot', error instanceof Error ? error.message : 'Could not complete this instruction. No wager was placed.'); }
  finally { setBusy(false); }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitMessage(input.value);
});
for (const prompt of ['Show games', 'Remove weakest', 'Trim to 10 odds', 'Split into 2', 'Generate code']) {
  actionButton(examples, prompt, () => submitMessage(prompt));
}
const saveButton = actionButton(examples, 'Move to My Slip', async () => {
  setBusy(true);
  try {
    if (pending) await reanalyze();
    saveToSlip();
  } catch (error) { bubble('bot', error.message || 'Could not save the slip.'); }
  finally { setBusy(false); }
});
saveButton.classList.add('aurex-chat-save');
manual.addEventListener('click', () => {
  if (busy) return;
  if (modified) {
    bubble('bot', 'This chat has edited your slip. To avoid two mismatched copies, paste the original booking code again before switching to the manual editor.');
    return;
  }
  mode = 'manual';
  chat.classList.add('hidden');
  if (manualWorkspace) manualWorkspace.style.display = '';
});
document.addEventListener('aurex:code-workspace-clear', () => {
  slip = null; desiredOdds = null; pending = false; modified = false; mode = 'chat';
  chat.classList.add('hidden');
  transcript.replaceChildren();
  if (manualWorkspace) manualWorkspace.style.display = '';
});
document.addEventListener('aurex:code-analyzed', (event) => {
  if (!event.detail?.editableSlip?.selections?.length) return;
  slip = { ...event.detail.editableSlip,
    selections: rankByScore(event.detail.editableSlip.selections) };
  desiredOdds = null; pending = false; modified = false; mode = 'chat';
  chat.classList.remove('hidden');
  transcript.replaceChildren();
  if (manualWorkspace) manualWorkspace.style.display = 'none';
  bubble('bot', `Imported ${slip.selections.length} eligible selections from ${slip.sourceCode || 'your code'}. They are ranked highest AI evidence score first. Tell me what you want changed; I will recheck the live SportyBet markets before returning any new code.`);
});
