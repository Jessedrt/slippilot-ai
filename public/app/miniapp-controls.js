// Odds-first Mini App enhancement. The server re-computes the authoritative count
// with src/slips/odds-target.ts; this preview must use the same planning heuristic.
const form = document.querySelector('#build-form');
const oddsInput = document.querySelector('#target-odds');
const riskInput = document.querySelector('#risk-mode');
const buildError = document.querySelector('#build-error');
const estimate = document.querySelector('#estimated-games');

if (form && oddsInput && riskInput && buildError && estimate) {
  const styles = document.createElement('style');
  styles.textContent = `
    .field-help { display: block; margin: 8px 0 0; color: #91a29b; font-size: .74rem; line-height: 1.5; text-transform: none; letter-spacing: normal; }
    #target-odds, #risk-mode { min-width: 0; font-size: 16px; }
    .odds-estimate { margin-top: 20px; padding: 16px; border: 1px solid rgba(200,255,69,.21); border-radius: 10px; background: rgba(200,255,69,.045); }
    .odds-estimate > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .odds-estimate span { color: #b8cac0; font-size: .72rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .odds-estimate strong { color: #c8ff45; font-size: 1.12rem; text-align: right; font-variant-numeric: tabular-nums; }
    .odds-estimate p { margin: 9px 0 0; color: #91a29b; font-size: .74rem; line-height: 1.5; }
    .sportybet-open-link { display: flex; justify-content: center; align-items: center; min-height: 46px; margin-top: 12px; padding: 10px 14px; background: #c8ff45; color: #07110f; text-align: center; font-size: .9rem; font-weight: 900; text-decoration: none; }
    .sportybet-open-link:focus-visible { outline: 2px solid #f4f7ef; outline-offset: 3px; }
    @media (max-width: 375px) { .form-row { grid-template-columns: 1fr; } }
  `;
  document.head.append(styles);

  // Match the Telegram bot's automaticLegCount() for UI feedback only.
  const estimateGames = (odds, riskMode) => {
    const desired = riskMode === 'conservative' ? 1.35 : riskMode === 'aggressive' ? 1.8 : 1.55;
    return Math.max(1, Math.ceil(Math.log(odds) / Math.log(desired)));
  };
  const normalizedOdds = () => oddsInput.value.trim().replace(',', '.');
  const isValidOdds = (raw) =>
    /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) && Number.isFinite(Number(raw)) && Number(raw) >= 1.01;

  const updateEstimate = () => {
    const raw = normalizedOdds();
    if (!isValidOdds(raw)) {
      estimate.textContent = raw ? 'Enter valid odds' : 'Enter target odds';
      return;
    }
    const count = estimateGames(Number(raw), riskInput.value);
    estimate.textContent = `About ${count} ${count === 1 ? 'game' : 'games'}`;
  };

  const reportError = (message) => {
    buildError.textContent = message;
    buildError.classList.remove('hidden');
    oddsInput.focus();
  };

  // A decimal-friendly text field avoids Safari's number/step validation of integer odds.
  oddsInput.type = 'text';
  oddsInput.inputMode = 'decimal';
  oddsInput.addEventListener('input', () => {
    buildError.classList.add('hidden');
    updateEstimate();
  });
  oddsInput.addEventListener('invalid', () => reportError('Enter your target combined odds, such as 2, 10 or 150.'));
  riskInput.addEventListener('change', updateEstimate);
  document.querySelectorAll('[data-preset-odds]').forEach((button) => {
    // app.js fills the input in its click listener. Refresh after that listener runs.
    button.addEventListener('click', updateEstimate);
  });

  // Capture validation runs before the existing bubble-phase build handler.
  form.addEventListener('submit', (event) => {
    const raw = normalizedOdds();
    if (!isValidOdds(raw)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      reportError('Enter valid decimal odds of at least 1.01, such as 2, 10 or 150.');
      return;
    }
    oddsInput.value = raw;
  }, true);
  updateEstimate();
}

// The primary generator in app.js renders the result asynchronously. Only show this
// action for a successfully generated, valid SportyBet code; keep Copy as a fallback.
const codePanel = document.querySelector('#code-result');
if (codePanel) {
  const addOpenLink = () => {
    if (codePanel.querySelector('h3')?.textContent !== 'Booking code ready') return;
    const block = codePanel.querySelector('.code-block');
    const code = block?.querySelector('code')?.textContent?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{4,20}$/.test(code) || codePanel.querySelector('.sportybet-open-link')) return;
    const link = document.createElement('a');
    link.className = 'sportybet-open-link';
    link.textContent = '↗ Open in SportyBet';
    link.href = `https://www.sportybet.com/ng/?shareCode=${encodeURIComponent(code)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.addEventListener('click', (event) => {
      const openLink = window.Telegram?.WebApp?.openLink;
      if (!openLink) return;
      event.preventDefault();
      openLink.call(window.Telegram.WebApp, link.href);
    });
    block.after(link);
  };
  new MutationObserver(addOpenLink).observe(codePanel, { childList: true });
  addOpenLink();
}
