// Navigation enhancement: keep the existing app.js view switching as the source
// of truth. This module only adds accessibility, badge display, and feedback.
const navigation = document.querySelector('.bottom-nav');

if (navigation) {
  const items = [...navigation.querySelectorAll('button[data-view]')];
  const countNode = navigation.querySelector('#slip-count');
  const slipItem = navigation.querySelector('[data-view="slip"]');

  const syncActiveState = () => {
    items.forEach((item) => {
      if (item.classList.contains('active')) {
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('aria-current');
      }
    });
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

  // A light selection haptic only when moving between views.
  navigation.addEventListener('click', (event) => {
    const item = event.target.closest('button[data-view]');
    if (!item || !navigation.contains(item) || item.classList.contains('active')) return;
    try {
      window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.();
    } catch {
      // Navigation must work outside Telegram too.
    }
  }, { capture: true });

  // Native Tab/Enter remain intact; arrows and Home/End are optional shortcuts
  // for people navigating this dock using a hardware keyboard.
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
