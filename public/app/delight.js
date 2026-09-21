// Isolated design preview. One presentation layer; app.js and other modules own all real behavior.
const reset = document.createElement('link');
reset.rel = 'stylesheet';
reset.href = '/app/aurex-reset.css?v=3.0.0';
document.head.append(reset);

const shell = document.querySelector('.app-shell');
const tabs = [...document.querySelectorAll('.bottom-nav button[data-view]')];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
if (shell && tabs.length) {
  document.addEventListener('click', (event) => {
    const destination = event.target.closest?.('[data-view], [data-go]');
    if (!destination) return;
    const view = destination.dataset.view || destination.dataset.go;
    const from = tabs.findIndex((tab) => tab.classList.contains('active'));
    const to = tabs.findIndex((tab) => tab.dataset.view === view);
    if (from >= 0 && to >= 0 && from !== to) shell.dataset.navDirection = to > from ? 'forward' : 'backward';
  }, { capture: true });
}
// Existing navigation, build, analyze, editor, fixtures and code-generation listeners are untouched.
const estimate = document.querySelector('#estimated-games');
if (estimate) {
  let previous = estimate.textContent;
  new MutationObserver(() => {
    const current = estimate.textContent;
    if (current === previous) return;
    previous = current;
    if (reduced.matches) return;
    estimate.classList.remove('aurex-number-pop');
    void estimate.offsetWidth;
    estimate.classList.add('aurex-number-pop');
  }).observe(estimate, { childList: true, characterData: true, subtree: true });
}
