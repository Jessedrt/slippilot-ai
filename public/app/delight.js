// Progressive visual enhancement only. app.js owns navigation, odds and slip logic.
// This single final stylesheet normalizes the earlier overlapping visual layers.
const stabilityStyle = document.createElement('link');
stabilityStyle.rel = 'stylesheet';
stabilityStyle.href = '/app/stability.css?v=6.0.0';
document.head.append(stabilityStyle);

const shell = document.querySelector('.app-shell');
const tabs = [...document.querySelectorAll('.bottom-nav button[data-view]')];
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Set direction before app.js handles the click. Include the empty-slip shortcut.
if (shell && tabs.length) {
  document.addEventListener('click', (event) => {
    const destination = event.target.closest?.('[data-view], [data-go]');
    if (!destination) return;
    const view = destination.dataset.view || destination.dataset.go;
    const activeIndex = tabs.findIndex((tab) => tab.classList.contains('active'));
    const nextIndex = tabs.findIndex((tab) => tab.dataset.view === view);
    if (activeIndex < 0 || nextIndex < 0 || nextIndex === activeIndex) return;
    shell.dataset.navDirection = nextIndex > activeIndex ? 'forward' : 'backward';
  }, { capture: true });
}

// One ripple per tap; never intercept, delay or repeat the underlying click.
document.addEventListener('pointerdown', (event) => {
  if (prefersReducedMotion.matches || (event.pointerType === 'mouse' && event.button !== 0)) return;
  const button = event.target.closest?.('.primary, .quick-presets button, .tool-card button, .empty-state button');
  if (!button || button.disabled || !shell?.contains(button)) return;
  const rect = button.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const diameter = Math.hypot(rect.width, rect.height) * 2;
  const ripple = document.createElement('span');
  ripple.className = 'aurex-ripple';
  ripple.setAttribute('aria-hidden', 'true');
  ripple.style.width = `${diameter}px`;
  ripple.style.height = `${diameter}px`;
  ripple.style.left = `${event.clientX - rect.left - diameter / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - diameter / 2}px`;
  button.append(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}, { passive: true });

// Animate genuinely changed estimates only, not every keystroke.
const estimate = document.querySelector('#estimated-games');
if (estimate) {
  let previousValue = estimate.textContent;
  new MutationObserver(() => {
    const nextValue = estimate.textContent;
    if (nextValue === previousValue) return;
    previousValue = nextValue;
    if (prefersReducedMotion.matches) return;
    estimate.classList.remove('aurex-number-pop');
    void estimate.offsetWidth;
    estimate.classList.add('aurex-number-pop');
  }).observe(estimate, { childList: true, characterData: true, subtree: true });
}
