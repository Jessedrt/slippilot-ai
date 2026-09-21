// The approved four-screen rebuild is isolated to this preview branch.
// Disable all inherited visual layers; do not alter the production API or app handlers.
for (const link of document.querySelectorAll('link[rel="stylesheet"][href^="/app/"]')) link.disabled = true;
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet'; stylesheet.href = '/app/aurex-rebuild.css?v=4.0.0';
document.head.append(stylesheet);
// The legacy menu adds a decorative sixth grid child. Hide it and explicitly
// anchor the two original right-hand tabs around the new functional center orb.
const nav = document.querySelector('.bottom-nav');
nav?.querySelector('.glass-indicator')?.setAttribute('hidden', '');
nav?.querySelector('[data-view="slip"]')?.style.setProperty('grid-column', '4');
nav?.querySelector('[data-view="explore"]')?.style.setProperty('grid-column', '5');
void import('./aurex-rebuild.js?v=4.0.0').catch(error => console.error('Aurex rebuilt UI could not initialize', error));
void import('./aurex-slip-export.js?v=1.0.0').catch(error => console.error('Aurex sharing could not initialize', error));
// Modules loaded after this script add their own feature styles; the unified
// design system must remain the final layer without disabling functional controls.
document.addEventListener('DOMContentLoaded', () => document.head.append(stylesheet), { once: true });
