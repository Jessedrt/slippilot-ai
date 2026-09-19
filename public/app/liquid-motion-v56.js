// Decorative sport-selector lens. The native radio inputs remain the only source
// of truth: no synthetic clicks, navigation interception, or betting API changes.
const sportSelector = document.querySelector('#build-form .segmented');

if (sportSelector && !sportSelector.querySelector('.aurex-sport-lens')) {
  const lens = document.createElement('div');
  lens.className = 'aurex-sport-lens';
  lens.setAttribute('aria-hidden', 'true');
  sportSelector.prepend(lens);

  let frame = 0;
  const positionLens = () => {
    frame = 0;
    const chosen = sportSelector.querySelector('input[name="sport"]:checked');
    const pill = chosen?.nextElementSibling;
    if (!pill) return;
    const host = sportSelector.getBoundingClientRect();
    const rect = pill.getBoundingClientRect();
    // The Build view is display:none when inactive; wait for it to be visible.
    if (host.width < 1 || rect.width < 1 || rect.height < 1) return;
    sportSelector.style.setProperty('--sport-lens-x', `${rect.left - host.left}px`);
    sportSelector.style.setProperty('--sport-lens-y', `${rect.top - host.top}px`);
    sportSelector.style.setProperty('--sport-lens-width', `${rect.width}px`);
    sportSelector.style.setProperty('--sport-lens-height', `${rect.height}px`);
    if (!sportSelector.classList.contains('aurex-lens-ready')) {
      sportSelector.classList.add('aurex-lens-ready');
      requestAnimationFrame(() => sportSelector.classList.add('aurex-lens-animated'));
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(positionLens);
  };

  sportSelector.addEventListener('change', schedule);
  // Tennis and handball join the selector after this module initializes.
  new MutationObserver(schedule).observe(sportSelector, { childList: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(sportSelector);
  else window.addEventListener('resize', schedule, { passive: true });
  const buildView = document.querySelector('#build-view');
  if (buildView) new MutationObserver(schedule).observe(buildView, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pageshow', schedule, { passive: true });
  schedule();
}
