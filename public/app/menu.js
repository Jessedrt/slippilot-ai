// Preserve app.js as the source of truth for view switching. Enhance the dock
// with a non-interactive sliding glass lens, accessible state, and feedback.
const navigation = document.querySelector('.bottom-nav');

if (navigation) {
  const items = [...navigation.querySelectorAll('button[data-view]')];
  const countNode = navigation.querySelector('#slip-count');
  const slipItem = navigation.querySelector('[data-view="slip"]');
  const lens = document.createElement('span');
  lens.className = 'glass-indicator';
  lens.setAttribute('aria-hidden', 'true');
  navigation.append(lens);

  let lensScheduled = false;
  const moveLens = () => {
    if (lensScheduled) return;
    lensScheduled = true;
    requestAnimationFrame(() => {
      lensScheduled = false;
      if (!navigation.isConnected) return;
      const active = items.find((item) => item.classList.contains('active')) || items[0];
      if (!active) return;
      const navBox = navigation.getBoundingClientRect();
      const tabBox = active.getBoundingClientRect();
      if (!navBox.width || !tabBox.width || !tabBox.height) return;
      navigation.style.setProperty('--glass-x', `${tabBox.left - navBox.left}px`);
      navigation.style.setProperty('--glass-y', `${tabBox.top - navBox.top}px`);
      navigation.style.setProperty('--glass-width', `${tabBox.width}px`);
      navigation.style.setProperty('--glass-height', `${tabBox.height}px`);
      navigation.classList.add('liquid-ready');
    });
  };

  const syncActiveState = () => {
    items.forEach((item) => {
      if (item.classList.contains('active')) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    moveLens();
  };

  const syncSlipBadge = () => {
    if (!countNode || !slipItem) return;
    const count = Number.parseInt(countNode.textContent || '0', 10);
    const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
    countNode.classList.toggle('is-empty', safeCount === 0);
    slipItem.setAttribute(
      'aria-label',
      safeCount ? `My slip, ${safeCount} ${safeCount === 1 ? 'selection' : 'selections'}` : 'My slip, no selections',
    );
  };

  items.forEach((item) => {
    new MutationObserver(syncActiveState).observe(item, {
      attributes: true,
      attributeFilter: ['class'],
    });
  });
  if (countNode) {
    new MutationObserver(syncSlipBadge).observe(countNode, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  // Keep the glass aligned on rotation, viewport changes, and text resizing.
  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(moveLens);
    resizeObserver.observe(navigation);
    items.forEach((item) => resizeObserver.observe(item));
  }
  window.addEventListener('resize', moveLens, { passive: true });

  // One selection haptic per real navigation change; no haptic on repeat taps.
  navigation.addEventListener('click', (event) => {
    const item = event.target.closest('button[data-view]');
    if (!item || !navigation.contains(item) || item.classList.contains('active')) return;
    try {
      window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
    } catch {
      // Web browsers without Telegram still navigate normally.
    }
  }, { capture: true });

  // Native Tab/Enter work unchanged; arrow/Home/End are optional shortcuts.
  navigation.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const focused = event.target.closest('button[data-view]');
    const position = items.indexOf(focused);
    if (position < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
      : (position + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
    items[next].click();
  });

  syncActiveState();
  syncSlipBadge();
}
