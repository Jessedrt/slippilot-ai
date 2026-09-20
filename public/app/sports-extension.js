// Add the new sports before desk.js registers the Explore fixture-button handlers.
// Build uses the existing form's sport field; all requests still require Telegram auth.
const sportChoices = [
  { id: 'tennis', label: '🎾 Tennis' },
  { id: 'handball', label: '🤾 Handball' },
];
const buildSports = document.querySelector('#build-form .segmented');
const exploreSports = document.querySelector('#explore-view .desk-filter');
for (const sport of sportChoices) {
  if (buildSports && !buildSports.querySelector(`[value="${sport.id}"]`)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'sport'; input.value = sport.id;
    const text = document.createElement('span');
    text.textContent = sport.label;
    label.append(input, text);
    buildSports.append(label);
  }
  if (exploreSports && !exploreSports.querySelector(`[data-fixture-sport="${sport.id}"]`)) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.fixtureSport = sport.id;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = sport.label;
    exploreSports.append(button);
  }
}
const sportStyles = document.createElement('style');
sportStyles.textContent = '.segmented { grid-template-columns: repeat(2, minmax(0,1fr)); } .segmented label { min-width: 0; } .desk-filter { flex-wrap: wrap; }';
document.head.append(sportStyles);

// The imported-code editor has its own code-generation panel. Never mislabel an
// HTTPS website URL as a native iPhone app link: SportyBet controls app handoff.
const analyzeView = document.querySelector('#analyze-view');
function addEditedCodeLink() {
  const output = analyzeView?.querySelector('.code-workspace-code');
  if (!output || output.querySelector('.sportybet-open-link')) return;
  const code = output.querySelector('code')?.textContent?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9]{4,20}$/.test(code)) return;

  const hint = document.createElement('p');
  hint.className = 'sportybet-handoff-hint';
  hint.setAttribute('role', 'status');
  hint.textContent = 'Copy this new code, switch to the installed SportyBet app and paste into Load Booking Code.';

  const copyForApp = document.createElement('button');
  copyForApp.type = 'button';
  copyForApp.className = 'sportybet-open-link';
  copyForApp.textContent = 'Copy code for SportyBet app';
  copyForApp.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code);
      hint.textContent = 'Code copied. Switch to SportyBet → Load Booking Code → Paste.';
      copyForApp.textContent = '✓ Copied — open SportyBet manually';
    } catch {
      hint.textContent = 'Copy the code shown above, then switch to SportyBet → Load Booking Code → Paste.';
      window.prompt('Copy your SportyBet booking code:', code);
    }
  });

  const webLink = document.createElement('a');
  webLink.className = 'sportybet-browser-link';
  webLink.textContent = 'Optional: open SportyBet website (browser)';
  webLink.href = `https://www.sportybet.com/?shareCode=${encodeURIComponent(code)}`;
  webLink.target = '_blank';
  webLink.rel = 'noopener noreferrer';
  output.append(hint, copyForApp, webLink);
}
if (analyzeView) {
  new MutationObserver(addEditedCodeLink).observe(analyzeView, { childList: true, subtree: true });
  addEditedCodeLink();
}
