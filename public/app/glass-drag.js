// Progressive enhancement for the existing tap/keyboard navigation. The app's
// button click handler remains the only place that actually switches screens.
const dock = document.querySelector('.bottom-nav');
const glass = dock?.querySelector('.glass-indicator');
const tabs = dock ? [...dock.querySelectorAll('button[data-view]')] : [];

if (dock && glass && tabs.length) {
  let gesture = null;
  let ignoreNativeClick = false;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const restore = () => {
    dock.classList.remove('glass-dragging');
    const active = tabs.find((tab) => tab.classList.contains('active')) || tabs[0];
    const container = dock.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    dock.style.setProperty('--glass-x', `${box.left - container.left}px`);
    dock.style.setProperty('--glass-y', `${box.top - container.top}px`);
    dock.style.setProperty('--glass-width', `${box.width}px`);
    dock.style.setProperty('--glass-height', `${box.height}px`);
  };

  dock.addEventListener('pointerdown', (event) => {
    if (gesture || !event.target.closest('button[data-view]')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const active = tabs.find((tab) => tab.classList.contains('active')) || tabs[0];
    const rect = active.getBoundingClientRect();
    gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialCenter: rect.left + rect.width / 2,
      currentCenter: rect.left + rect.width / 2,
      width: rect.width,
      moved: false,
    };
    try { dock.setPointerCapture(event.pointerId); } catch { /* capture unsupported */ }
  });

  dock.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) return;
      if (Math.abs(dx) < 9 || Math.abs(dx) < Math.abs(dy)) return;
      gesture.moved = true;
      dock.classList.add('glass-dragging');
    }
    const navRect = dock.getBoundingClientRect();
    const first = tabs[0].getBoundingClientRect();
    const last = tabs[tabs.length - 1].getBoundingClientRect();
    const minCenter = first.left + first.width / 2;
    const maxCenter = last.left + last.width / 2;
    gesture.currentCenter = clamp(gesture.initialCenter + dx, minCenter, maxCenter);
    dock.style.setProperty('--glass-x', `${gesture.currentCenter - gesture.width / 2 - navRect.left}px`);
    dock.classList.add('liquid-ready');
    if (event.cancelable) event.preventDefault();
  });

  dock.addEventListener('pointerup', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const finished = gesture;
    gesture = null;
    if (dock.hasPointerCapture?.(event.pointerId)) dock.releasePointerCapture(event.pointerId);
    dock.classList.remove('glass-dragging');
    if (!finished.moved) { restore(); return; }
    // Ignore the browser's trailing trusted click on the original pressed tab;
    // the snapped target gets exactly one intentional programmatic click.
    ignoreNativeClick = true;
    setTimeout(() => { ignoreNativeClick = false; }, 0);
    const target = tabs.reduce((nearest, tab) => {
      const center = tab.getBoundingClientRect();
      const distance = Math.abs(center.left + center.width / 2 - finished.currentCenter);
      const current = nearest.getBoundingClientRect();
      return distance < Math.abs(current.left + current.width / 2 - finished.currentCenter) ? tab : nearest;
    }, tabs[0]);
    if (!target.classList.contains('active')) target.click();
    restore();
    if (event.cancelable) event.preventDefault();
  });

  const cancel = (event) => {
    if (!gesture || (event.pointerId !== undefined && event.pointerId !== gesture.id)) return;
    gesture = null;
    restore();
  };
  dock.addEventListener('pointercancel', cancel);
  dock.addEventListener('lostpointercapture', cancel);
  // Window capture precedes the dock's tap and haptic listeners.
  window.addEventListener('click', (event) => {
    if (ignoreNativeClick && event.isTrusted && dock.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // Telegram's Close / overflow controls overlay the first 60-80 CSS pixels.
  // Only increase top clearance inside an authenticated Telegram WebView.
  if (window.Telegram?.WebApp?.initData) {
    const main = document.querySelector('.app-shell main');
    if (main) main.style.paddingTop = 'max(72px, calc(env(safe-area-inset-top, 0px) + 32px))';
  }
}
