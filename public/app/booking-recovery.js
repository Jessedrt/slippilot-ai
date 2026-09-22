import './provider-diagnostics-ui.js';

// AUREX recovery for a provider-reported unverified slip. Never silently
// delete a selection, substitute a market, generate a code or place a wager.
const resultPanel = document.querySelector('#code-result');
const pickList = document.querySelector('#pick-list');

function storedSlip() {
  try {
    const value = JSON.parse(localStorage.getItem('aurex-active-slip') || 'null');
    return value && Array.isArray(value.selections) ? value : null;
  } catch { return null; }
}

function unavailableNumbers(message, slip) {
  if (!message.startsWith('Market unavailable: #') || !slip?.selections?.length) return [];
  const matches = [...message.matchAll(/#(\d+) ([^;]+?): (Market unavailable or suspended|Fixture missing or already started|Exact market could not be verified for booking \(not necessarily suspended\))(?=;|\.|$)/g)];
  if (!matches.length) return [];
  const numbers = [];
  for (const match of matches) {
    const number = Number(match[1]);
    const selection = slip.selections[number - 1];
    // The response must identify precisely the same original pick. Abort
    // recovery on any mismatch, rather than deleting an unrelated selection.
    if (!Number.isSafeInteger(number) || !selection || numbers.includes(number) ||
        !match[2].startsWith(`${selection.homeTeam} vs ${selection.awayTeam} (${selection.selectionName})`)) return [];
    numbers.push(number);
  }
  return numbers;
}

function offerRecovery() {
  if (!resultPanel || !pickList || resultPanel.querySelector('[data-repair-unavailable]')) return;
  if (resultPanel.querySelector('h3')?.textContent !== 'Code not created') return;
  const slip = storedSlip();
  const message = resultPanel.querySelector('p')?.textContent || '';
  const numbers = unavailableNumbers(message, slip);
  if (!numbers.length) return;

  const explanation = document.createElement('p');
  explanation.className = 'sportybet-handoff-hint';
  explanation.textContent = `${numbers.length} selection${numbers.length === 1 ? '' : 's'} could not be verified for booking. You can remove only the flagged picks and reanalyze the rest. Your original odds target may no longer be met.`;
  const repair = document.createElement('button');
  repair.type = 'button';
  repair.className = 'sportybet-open-link';
  repair.dataset.repairUnavailable = 'true';
  repair.textContent = numbers.length === slip.selections.length ? 'Build a fresh slip' :
    `Review and repair ${numbers.length} unverified pick${numbers.length === 1 ? '' : 's'}`;
  repair.addEventListener('click', () => {
    const current = storedSlip();
    if (!current || current.slipId !== slip.slipId ||
        JSON.stringify(current.selections) !== JSON.stringify(slip.selections)) {
      explanation.textContent = 'The slip changed. Generate a new verification result first.';
      repair.disabled = true;
      return;
    }
    if (numbers.length === current.selections.length) {
      document.querySelector('#build-tab')?.click();
      return;
    }
    const list = numbers.map((number) => `#${number} ${current.selections[number - 1].homeTeam} vs ${current.selections[number - 1].awayTeam}`).join('\n');
    if (!window.confirm(`Remove these unverified selections and reanalyze the remaining ${current.selections.length - numbers.length} picks?\n\n${list}\n\nCombined odds and the requested match count will change. Nothing will be booked automatically.`)) return;
    repair.disabled = true;
    // Existing click handlers own slip state, mark it pending, and update the UI.
    // Descending order avoids shifting any still-to-be-removed selection index.
    for (const number of [...numbers].sort((a, b) => b - a)) {
      const remove = pickList.querySelector(`[data-remove="${number - 1}"]`);
      if (!remove) {
        explanation.textContent = 'The slip changed while recovering. Check your remaining picks and reanalyze manually.';
        return;
      }
      remove.click();
    }
    explanation.textContent = 'Unverified picks removed. Rechecking the remaining markets and rerunning AI analysis…';
    const reanalyze = document.querySelector('#reanalyze-slip');
    if (reanalyze && !reanalyze.disabled) reanalyze.click();
    else explanation.textContent = 'Unverified picks removed. Tap Reanalyze above before requesting a code.';
  });
  resultPanel.append(explanation, repair);
}

if (resultPanel) {
  new MutationObserver(offerRecovery).observe(resultPanel, { childList: true });
  offerRecovery();
}
