// Small progressive enhancement for the existing AUREX Mini App builder.
// Keep the real build request in app.js: this module only manages inputs and validation.
const form = document.querySelector('#build-form');
const chips = document.querySelector('#count-chips');
const customButton = document.querySelector('#custom-count-button');
const customInput = document.querySelector('#custom-count');
const oddsInput = document.querySelector('#target-odds');
const buildError = document.querySelector('#build-error');

if (form && chips && customButton && customInput && oddsInput && buildError) {
  const styles = document.createElement('style');
  styles.textContent = `
    #count-chips { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    #custom-count-button { font-size: .7rem; padding-inline: 2px; }
    .custom-count-field { display: block; margin-top: 12px; color: #c7d2cd; font-size: .78rem; }
    .custom-count-field span { display: block; margin-bottom: 6px; }
    .custom-count-field input { width: 100%; max-width: 170px; height: 44px; border: 1px solid rgba(255,255,255,.15); border-radius: 6px; background: #07110f; color: #f4f7ef; padding: 0 12px; font: inherit; font-size: 16px; outline: none; }
    .custom-count-field input:focus { border-color: #c8ff45; }
    .field-help { display: block; margin: 8px 0 0; color: #91a29b; font-size: .72rem; line-height: 1.45; text-transform: none; letter-spacing: normal; }
    #target-odds { min-width: 0; font-size: 16px; }
    @media (max-width: 360px) { #count-chips { gap: 4px; } #count-chips button { font-size: .78rem; } #custom-count-button { font-size: .62rem; } }
  `;
  document.head.append(styles);

  const reportError = (message, input) => {
    buildError.textContent = message;
    buildError.classList.remove('hidden');
    input?.focus();
  };
  const validCount = (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 15;

  customButton.addEventListener('click', () => {
    // A custom chip starts at 5, then its data-count is updated from the numeric field.
    if (!customInput.value) customInput.value = customButton.dataset.count || '5';
    customInput.focus();
  });
  customInput.addEventListener('input', () => {
    const value = customInput.value.trim();
    if (!validCount(value)) return;
    customButton.dataset.count = value;
    customButton.textContent = `Custom ${value}`;
    // The existing delegated chip listener owns gameCount and selected state.
    customButton.click();
    buildError.classList.add('hidden');
  });
  chips.querySelectorAll('[data-count]:not(#custom-count-button)').forEach((button) => {
    button.addEventListener('click', () => {
      customInput.value = '';
      customButton.textContent = 'Custom';
    });
  });

  // iOS Safari's type=number with min=1.01 and step=.1 rejects integer odds such as 20.
  // A decimal keyboard + explicit validation accepts integer and decimal targets alike.
  oddsInput.type = 'text';
  oddsInput.inputMode = 'decimal';
  oddsInput.removeAttribute('step');
  oddsInput.removeAttribute('min');
  oddsInput.addEventListener('input', () => buildError.classList.add('hidden'));
  form.addEventListener('submit', (event) => {
    const raw = oddsInput.value.trim().replace(',', '.');
    if (raw && (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) < 1.01)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      reportError('Enter valid decimal odds of at least 1.01, such as 2, 20 or 150.', oddsInput);
      return;
    }
    oddsInput.value = raw;
    if (chips.querySelector('#custom-count-button.selected') && !validCount(customInput.value.trim())) {
      event.preventDefault();
      event.stopImmediatePropagation();
      reportError('Enter a whole number of games from 1 to 15.', customInput);
    }
  }, true);
}
