// AUREX 4 preview: exactly one unified skin. Production/main remains untouched.
// Keep the original functional app, analysis and editor modules in index.html.
for (const link of document.querySelectorAll('link[rel="stylesheet"][href^="/app/"]')) link.disabled = true;
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet'; stylesheet.href = '/app/aurex-rebuild.css?v=4.0.0';
document.head.append(stylesheet);
const nav = document.querySelector('.bottom-nav');
nav?.querySelector('.glass-indicator')?.setAttribute('hidden', '');
nav?.querySelector('[data-view="slip"]')?.style.setProperty('grid-column', '4');
nav?.querySelector('[data-view="explore"]')?.style.setProperty('grid-column', '5');
// News waits until the real four-screen DOM has been constructed.
void import('./aurex-rebuild.js?v=4.0.0')
  .then(() => import('./aurex-news.js?v=1.0.0'))
  .catch(error => console.error('Aurex rebuild or news could not initialize', error));
void import('./aurex-slip-export.js?v=1.0.0').catch(error => console.error('Aurex sharing could not initialize', error));
const newsStyles = document.createElement('link');
newsStyles.rel = 'stylesheet'; newsStyles.href = '/app/aurex-news.css?v=1.0.0';
document.head.append(newsStyles);
// Modules after this script may add feature-specific styles; retain the single
// shared design system as the last baseline while leaving news-specific rules intact.
document.addEventListener('DOMContentLoaded', () => {
  document.head.append(stylesheet);
  document.head.append(newsStyles);
}, { once: true });
