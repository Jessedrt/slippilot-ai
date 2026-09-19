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

// The imported-code editor has its own code-generation panel. Link only to a
// newly generated provider code, never to an unverified pasted code or analysis.
const analyzeView = document.querySelector('#analyze-view');
function addEditedCodeLink() {
  const output = analyzeView?.querySelector('.code-workspace-code');
  if (!output || output.querySelector('.sportybet-open-link')) return;
  const code = output.querySelector('code')?.textContent?.trim().toUpperCase();
  if (!code || !/^[A-Z0-9]{4,20}$/.test(code)) return;
  const link = document.createElement('a');
  link.className = 'sportybet-open-link';
  link.textContent = '↗ Open in SportyBet';
  link.href = `https://www.sportybet.com/?shareCode=${encodeURIComponent(code)}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = 'Open this freshly generated booking code for review; AUREX never places a bet.';
  output.append(link);
}
if (analyzeView) {
  new MutationObserver(addEditedCodeLink).observe(analyzeView, { childList: true, subtree: true });
  addEditedCodeLink();
}
