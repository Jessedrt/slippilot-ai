import './booking-recovery.js?v=5.7.0';

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
    .sportybet-open-link { display: flex; justify-content: center; align-items: center; width: 100%; min-height: 46px; margin-top: 12px; padding: 10px 14px; border: 0; background: #c8ff45; color: #07110f; text-align: center; font: inherit; font-size: .9rem; font-weight: 900; cursor: pointer; }
    .sportybet-open-link:focus-visible, .sportybet-browser-link:focus-visible { outline: 2px solid #f4f7ef; outline-offset: 3px; }
    .sportybet-handoff-hint { margin: 12px 0 0; color: #c5d3df; font-size: .78rem; line-height: 1.55; }
    .sportybet-handoff-hint[data-copied='true'] { color: #d5ff92; }
    .sportybet-browser-link { display: flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 8px; color: #d8eaff; text-decoration: underline; text-underline-offset: 3px; font-size: .78rem; }
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

// Telegram's openLink launches an external browser. SportyBet has not published
// a verified iOS deep link that AUREX can use to force-launch its installed app.
// Do not advertise an HTTPS code-loader link as an app launcher. Copy the real
// booking code on a user tap and explain how to switch apps; website is optional.
const codePanel = document.querySelector('#code-result');
if (codePanel) {
  const copyBookingCode = async (code) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(code);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = code;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.append(area);
      area.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* iOS may block legacy copy */ }
      area.remove();
      return copied;
    }
  };

  const addOpenLink = () => {
    if (codePanel.querySelector('h3')?.textContent !== 'Booking code ready') return;
    const block = codePanel.querySelector('.code-block');
    const code = block?.querySelector('code')?.textContent?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{4,20}$/.test(code) || codePanel.querySelector('.sportybet-open-link')) return;

    const hint = document.createElement('p');
    hint.className = 'sportybet-handoff-hint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');
    hint.textContent = 'SportyBet does not provide AUREX with a verified iPhone app-opening link. Copy the code, switch to your installed SportyBet app, then select Load Booking Code and paste it.';

    const copyForApp = document.createElement('button');
    copyForApp.type = 'button';
    copyForApp.className = 'sportybet-open-link';
    copyForApp.textContent = 'Copy code for SportyBet app';
    copyForApp.title = 'Copy the booking code to paste into the installed SportyBet app. This button does not open a browser or place a wager.';
    copyForApp.addEventListener('click', async () => {
      const copied = await copyBookingCode(code);
      if (copied) {
        hint.dataset.copied = 'true';
        hint.textContent = 'Code copied. Switch to the SportyBet app on your phone → Load Booking Code → Paste. No browser is needed.';
        copyForApp.textContent = '✓ Copied — open SportyBet manually';
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      } else {
        hint.dataset.copied = 'false';
        hint.textContent = 'Automatic copy was blocked. Copy the booking code shown above, then open SportyBet → Load Booking Code → Paste.';
        window.prompt('Copy your SportyBet booking code:', code);
      }
    });

    const webLink = document.createElement('a');
    webLink.className = 'sportybet-browser-link';
    webLink.textContent = 'Optional: open SportyBet website (browser)';
    webLink.href = `https://www.sportybet.com/?shareCode=${encodeURIComponent(code)}`;
    webLink.target = '_blank';
    webLink.rel = 'noopener noreferrer';
    webLink.title = 'Opens the SportyBet website, not its installed iPhone app. AUREX does not place a bet.';
    block.after(hint, copyForApp, webLink);
  };
  new MutationObserver(addOpenLink).observe(codePanel, { childList: true });
  addOpenLink();
}
