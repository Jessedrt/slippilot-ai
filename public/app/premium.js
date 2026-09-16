// Progressive presentation enhancements. Existing API and booking actions remain in app.js.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const tg = window.Telegram?.WebApp;

function safeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function storedSlip() {
  try {
    const data = JSON.parse(localStorage.getItem('aurex-active-slip') || 'null');
    return data && Array.isArray(data.selections) && data.analysisToken ? data : null;
  } catch {
    return null;
  }
}

function formatScore(value) {
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? `${Math.round(score)}/100` : '—';
}

function syncChips() {
  $$('#count-chips button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('selected')));
  });
}

const customButton = $('#custom-count-button');
const customField = $('.custom-count-field');
const customInput = $('#custom-count');
if (customButton && customField && customInput) {
  customButton.addEventListener('click', () => {
    customField.classList.add('is-open');
    customButton.setAttribute('aria-expanded', 'true');
  });
  $$('#count-chips button:not(#custom-count-button)').forEach((button) => {
    button.addEventListener('click', () => {
      customField.classList.remove('is-open');
      customButton.setAttribute('aria-expanded', 'false');
    });
  });
  $('#count-chips')?.addEventListener('click', () => queueMicrotask(syncChips));
  customInput.addEventListener('input', () => queueMicrotask(syncChips));
  syncChips();
}

const riskSelect = $('#risk-mode');
const riskButtons = $$('[data-risk]');
function syncRisk() {
  riskButtons.forEach((button) => {
    const chosen = button.dataset.risk === riskSelect?.value;
    button.classList.toggle('selected', chosen);
    button.setAttribute('aria-pressed', String(chosen));
  });
}
if (riskSelect && riskButtons.length) {
  riskButtons.forEach((button) => button.addEventListener('click', () => {
    riskSelect.value = button.dataset.risk;
    riskSelect.dispatchEvent(new Event('change', { bubbles: true }));
    syncRisk();
    tg?.HapticFeedback?.selectionChanged?.();
  }));
  riskSelect.addEventListener('change', syncRisk);
  $$('[data-preset-odds]').forEach((button) => button.addEventListener('click', () => {
    // The existing preset handler updates the hidden select first.
    queueMicrotask(syncRisk);
  }));
  syncRisk();
}

const viewButtons = $$('[data-view]');
function syncNavigation() {
  viewButtons.forEach((button) => {
    if (button.classList.contains('active')) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}
viewButtons.forEach((button) => button.addEventListener('click', () => queueMicrotask(syncNavigation)));

function renderInsights() {
  const root = $('#slip-insights');
  if (!root) return;
  const slip = storedSlip();
  const picks = slip?.selections ?? [];
  if (!picks.length) {
    root.innerHTML = `<div class="insights-empty"><span aria-hidden="true">✳</span><h3>Analysis starts with a slip</h3><p>Build a slip first to review its evidence scores and selections here.</p><button type="button" data-premium-build>Create a slip →</button></div>`;
    return;
  }
  const sum = picks.reduce((total, item) => total + Number(item.confidence || 0), 0);
  const average = sum / picks.length;
  const summary = slip.summary ? `<p class="insights-summary">${safeText(slip.summary)}</p>` : '';
  root.innerHTML = `
    <section class="insights-overview" aria-label="Slip evidence overview">
      <div class="insights-overview-top"><span class="insights-star" aria-hidden="true">✳</span><span>EVIDENCE QUALITY</span></div>
      <div class="insights-number">${formatScore(average)}</div>
      <div class="insights-meter" role="meter" aria-label="Average evidence quality" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(average)}"><span style="width:${Math.max(0, Math.min(100, average))}%"></span></div>
      <p class="insights-note">An assessment of evidence and market quality, not the probability of winning.</p>${summary}
    </section>
    <div class="picks-heading"><h3>Pick-by-pick review</h3><span class="analysis-count">${picks.length} selections</span></div>
    <div class="analysis-list">${picks.map((pick, index) => `
      <details class="analysis-item">
        <summary><span class="analysis-index">${String(index + 1).padStart(2, '0')}</span><span class="analysis-main"><strong>${safeText(pick.homeTeam)} vs ${safeText(pick.awayTeam)}</strong><small>${safeText(pick.selectionName)} · ${Number(pick.odds).toFixed(2)} odds</small></span><span class="analysis-score">${formatScore(pick.confidence)}</span><span class="analysis-chevron" aria-hidden="true">⌄</span></summary>
        <div class="analysis-detail"><span class="risk-tag risk-${safeText(pick.risk)}">${safeText(pick.risk)} risk</span><p>${pick.reason ? safeText(pick.reason) : 'Detailed reasoning is unavailable for this selection. Review the market and available evidence before using it.'}</p>${pick.verdict ? `<small>Review: ${safeText(pick.verdict)}</small>` : ''}</div>
      </details>`).join('')}</div>
    <div class="score-explainer"><span class="info-icon" aria-hidden="true">i</span><p><b>How scoring works.</b> AUREX evaluates the quality of available evidence. A higher number does not guarantee an outcome or represent its win probability.</p></div>`;
}

$('#review-analysis')?.addEventListener('click', () => {
  $('#analyze-tab')?.click();
  renderInsights();
});
$('#analyze-tab')?.addEventListener('click', renderInsights);
$('#slip-tab')?.addEventListener('click', () => queueMicrotask(syncSlipMeta));
$('#slip-insights')?.addEventListener('click', (event) => {
  if (event.target.closest('[data-premium-build]')) $('#build-tab')?.click();
});

function syncSlipMeta() {
  const slip = storedSlip();
  if ($('#slip-selection-count')) $('#slip-selection-count').textContent = String(slip?.selections?.length ?? 0);
  if ($('#slip-risk-label')) $('#slip-risk-label').textContent = String(slip?.riskMode ?? 'balanced').toUpperCase();
  const value = $('#average-confidence');
  if (value && slip?.selections?.length) {
    const score = slip.selections.reduce((total, item) => total + Number(item.confidence || 0), 0) / slip.selections.length;
    value.textContent = formatScore(score);
  }
}

// Observe existing render points so enhanced screens follow builds, removals and code generation.
const slipCount = $('#slip-count');
if (slipCount) new MutationObserver(() => { syncSlipMeta(); renderInsights(); }).observe(slipCount, { childList: true, characterData: true, subtree: true });
$('#pick-list')?.addEventListener('click', () => queueMicrotask(() => { syncSlipMeta(); renderInsights(); }));

function enhanceConfirmation() {
  const root = $('#code-result');
  if (!root || root.classList.contains('hidden') || root.dataset.enhanced === 'true') return;
  const code = root.querySelector('code')?.textContent?.trim();
  if (!code) return; // Leave error messages and other responses untouched.
  const originalText = root.querySelector('p')?.textContent ?? '';
  root.dataset.enhanced = 'true';
  const heading = document.createElement('div');
  heading.className = 'confirmation-heading';
  heading.innerHTML = '<span class="confirmation-check" aria-hidden="true">✓</span><span><strong>Booking code ready</strong><small>Your selections were shared with SportyBet.</small></span>';
  root.prepend(heading);
  const actions = document.createElement('div');
  actions.className = 'confirmation-actions';
  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'confirmation-share';
  share.textContent = 'Share code ↗';
  share.addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ text: `SportyBet booking code: ${code}` }); } catch { /* User cancelled. */ }
    } else {
      try { await navigator.clipboard.writeText(code); $('#toast').textContent = 'Code copied'; $('#toast').classList.add('show'); setTimeout(() => $('#toast').classList.remove('show'), 1800); } catch { share.textContent = 'Use the Copy button'; }
    }
  });
  actions.append(share);
  root.append(actions);
  root.setAttribute('aria-label', `Booking code generated. ${originalText}. No wager was submitted.`);
}
const codeResult = $('#code-result');
if (codeResult) {
  new MutationObserver(() => enhanceConfirmation()).observe(codeResult, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] });
  $('#generate-code')?.addEventListener('click', () => { delete codeResult.dataset.enhanced; });
}

syncSlipMeta();
renderInsights();
syncNavigation();
