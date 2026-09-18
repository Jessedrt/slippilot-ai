// Progressive enhancement only: the existing Mini App retains all API and slip logic.
const builder = document.querySelector('#build-form');
const oddsInput = document.querySelector('#target-odds');
const riskInput = document.querySelector('#risk-mode');
const riskHelp = document.querySelector('#risk-mode-help');
const presets = [...document.querySelectorAll('[data-preset-odds]')];
const draftKey = 'aurex-builder-preferences-v1';

const riskDescriptions = {
  conservative: 'Estimates using about 1.35 odds per selection. This is not a safety guarantee.',
  balanced: 'Estimates using about 1.55 odds per selection. This is not a winning probability.',
  aggressive: 'Estimates using about 1.80 odds per selection. This is not a winning probability.',
};

function updateBuilderHints() {
  if (!oddsInput || !riskInput) return;
  const odds = Number(oddsInput.value.trim().replace(',', '.'));
  presets.forEach((button) => {
    const matches = oddsInput.value.trim() !== '' && odds === Number(button.dataset.presetOdds);
    button.setAttribute('aria-pressed', String(matches));
  });
  if (riskHelp) riskHelp.textContent = riskDescriptions[riskInput.value] || riskDescriptions.balanced;
}

function saveBuilderPreferences() {
  if (!builder || !oddsInput || !riskInput) return;
  const sport = builder.querySelector('input[name="sport"]:checked')?.value || 'football';
  try {
    localStorage.setItem(draftKey, JSON.stringify({
      sport,
      targetOdds: oddsInput.value.slice(0, 24),
      riskMode: riskInput.value,
    }));
  } catch {
    // Storage may be blocked in embedded browsers; the form still works without it.
  }
  updateBuilderHints();
}

if (builder && oddsInput && riskInput) {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (saved && typeof saved === 'object') {
      if (saved.sport === 'football' || saved.sport === 'basketball') {
        const radio = builder.querySelector(`input[name="sport"][value="${saved.sport}"]`);
        if (radio) radio.checked = true;
      }
      if (Object.hasOwn(riskDescriptions, saved.riskMode)) riskInput.value = saved.riskMode;
      if (typeof saved.targetOdds === 'string' && /^[0-9.,]{1,24}$/.test(saved.targetOdds)) {
        oddsInput.value = saved.targetOdds;
      }
      // Recalculate the existing client-side estimate using its own listener.
      oddsInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch {
    // Ignore corrupt or unavailable storage rather than blocking the app.
  }
  builder.addEventListener('input', saveBuilderPreferences);
  builder.addEventListener('change', saveBuilderPreferences);
  presets.forEach((button) => button.addEventListener('click', saveBuilderPreferences));
  updateBuilderHints();
}

// Keep the active tab evident to assistive technology, including when the app
// navigates programmatically after a successful build.
const nav = document.querySelector('.bottom-nav');
if (nav) {
  const syncNavigation = () => {
    nav.querySelectorAll('[data-view]').forEach((button) => {
      if (button.classList.contains('active')) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  };
  new MutationObserver(syncNavigation).observe(nav, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  });
  syncNavigation();
}

const generatedCode = document.querySelector('#code-result');
function clearOutdatedCode() {
  if (!generatedCode) return;
  generatedCode.classList.add('hidden');
  generatedCode.replaceChildren();
}

// A code is tied to its previous selections. Never display it after the user
// changes the slip or starts building a replacement.
builder?.addEventListener('submit', clearOutdatedCode, { capture: true });
document.querySelector('#pick-list')?.addEventListener('click', (event) => {
  if (event.target.closest('[data-remove]')) clearOutdatedCode();
}, { capture: true });

const clearButton = document.querySelector('#clear-slip');
const pickList = document.querySelector('#pick-list');
clearButton?.addEventListener('click', () => {
  if (!pickList?.querySelector('[data-remove]')) return;
  if (!window.confirm('Remove all selections from your current slip?')) return;
  clearOutdatedCode();
  // Reuse the app's existing remove action so local storage and counters stay in sync.
  for (let i = 0; i < 200; i += 1) {
    const removeButton = pickList.querySelector('[data-remove]');
    if (!removeButton) break;
    removeButton.click();
  }
  if (!pickList.querySelector('[data-remove]')) {
    document.querySelector('#empty-slip [data-go]')?.focus();
  }
});

// Existing analysis handlers always render into this panel on completion. A
// single active operation avoids double submissions and gives clear feedback.
const analysisResult = document.querySelector('#analysis-result');
const analysisStatus = document.querySelector('#analysis-status');
let pendingAnalysis = null;
const analysisForms = [
  ['#read-code-form', 'Checking booking code…'],
  ['#x-form', 'Reading public post…'],
  ['#shot-form', 'Analyzing screenshot…'],
];

function finishAnalysis() {
  if (!pendingAnalysis) return;
  const { form, button, originalLabel } = pendingAnalysis;
  button.textContent = originalLabel;
  button.disabled = false;
  form.removeAttribute('aria-busy');
  analysisStatus?.classList.add('hidden');
  pendingAnalysis = null;
}

analysisForms.forEach(([selector, message]) => {
  const form = document.querySelector(selector);
  const button = form?.querySelector('button[type="submit"]');
  if (!form || !button || !analysisResult || !analysisStatus) return;
  form.addEventListener('submit', (event) => {
    if (pendingAnalysis) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    analysisResult.classList.add('hidden');
    analysisResult.replaceChildren();
    pendingAnalysis = { form, button, originalLabel: button.textContent };
    form.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.textContent = 'Working…';
    analysisStatus.textContent = message;
    analysisStatus.classList.remove('hidden');
  }, { capture: true });
});

if (analysisResult) {
  new MutationObserver(() => {
    if (!analysisResult.classList.contains('hidden') && analysisResult.hasChildNodes()) {
      finishAnalysis();
    }
  }).observe(analysisResult, { childList: true });
}
