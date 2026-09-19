import './liquid-motion-v56.js?v=5.6.0';

// Visual-only liquid-glass deformation. glass-drag.js remains the only gesture
// controller and app.js remains the only view-switching implementation.
const motionDock = document.querySelector('.bottom-nav');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedTransparency = window.matchMedia('(prefers-reduced-transparency: reduce)');

if (motionDock) {
  let pointer = null;
  let frame = 0;
  let nextX = 0;
  let nextStretch = 1;

  const render = () => {
    frame = 0;
    if (!pointer) return;
    motionDock.style.setProperty('--glass-glint', `${nextX}%`);
    motionDock.style.setProperty('--glass-stretch', String(nextStretch));
  };

  const reset = () => {
    pointer = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    motionDock.style.setProperty('--glass-stretch', '1');
    motionDock.style.setProperty('--glass-glint', '40%');
  };

  motionDock.addEventListener('pointerdown', (event) => {
    if (pointer || reducedMotion.matches || reducedTransparency.matches) return;
    if (!event.target.closest('button[data-view]')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    const bounds = motionDock.getBoundingClientRect();
    nextX = Math.max(12, Math.min(88, (event.clientX - bounds.left) / bounds.width * 100));
    nextStretch = 1;
    if (!frame) frame = requestAnimationFrame(render);
  }, { passive: true });

  motionDock.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const distanceX = event.clientX - pointer.x;
    const distanceY = event.clientY - pointer.y;
    if (Math.abs(distanceX) < 7 || Math.abs(distanceX) < Math.abs(distanceY)) return;
    const bounds = motionDock.getBoundingClientRect();
    nextX = Math.max(12, Math.min(88, (event.clientX - bounds.left) / bounds.width * 100));
    // Small and bounded: deformation conveys pressure but never obscures a tab.
    nextStretch = 1 + Math.min(.12, Math.abs(distanceX) / Math.max(bounds.width, 1) * .2);
    if (!frame) frame = requestAnimationFrame(render);
  }, { passive: true });

  motionDock.addEventListener('pointerup', (event) => {
    if (pointer?.id === event.pointerId) reset();
  }, { passive: true });
  motionDock.addEventListener('pointercancel', reset, { passive: true });
  motionDock.addEventListener('lostpointercapture', reset);
  window.addEventListener('blur', reset);
  reducedMotion.addEventListener?.('change', reset);
  reducedTransparency.addEventListener?.('change', reset);
}
