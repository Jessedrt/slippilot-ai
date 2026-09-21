/* Aurex redesign preview. Presentation only: existing forms, providers and code generation retain ownership. */
const root = document.querySelector('.app-shell');
if (root && !document.querySelector('.aurex-brandbar')) {
  document.body.classList.add('aurex-redesign');
  const brandbar = document.createElement('header');
  brandbar.className = 'aurex-brandbar';
  brandbar.innerHTML = `<a class="aurex-brand" href="/app/" aria-label="Aurex home"><span class="aurex-brand-symbol" aria-hidden="true">A</span><span class="aurex-brand-name">aure<span>x</span><small>SPORTS INTELLIGENCE</small></span></a><div class="aurex-brandbar-right"><span class="aurex-preview-badge"><i aria-hidden="true"></i> DESIGN PREVIEW</span><button class="aurex-header-action" type="button">Analyze a code <span aria-hidden="true">↗</span></button></div>`;
  root.insertBefore(brandbar, root.firstChild);
  const go = (name) => document.querySelector(`#${name}-tab`)?.click();
  brandbar.querySelector('.aurex-header-action')?.addEventListener('click', () => go('analyze'));
  brandbar.querySelector('.aurex-brand')?.addEventListener('click', (event) => { event.preventDefault(); go('build'); });

  const hero = document.querySelector('#build-view .hero-copy');
  if (hero) {
    hero.classList.add('aurex-feature-hero');
    const kicker = document.createElement('div');
    kicker.className = 'aurex-feature-kicker';
    kicker.innerHTML = '<span class="aurex-status-dot" aria-hidden="true"></span> THE INTELLIGENT SLIP WORKSPACE';
    hero.prepend(kicker);
    const title = hero.querySelector('h1');
    if (title) title.innerHTML = 'Make every <em>pick</em><br> count<span class="aurex-period">.</span>';
    const intro = hero.querySelector('p:last-of-type');
    if (intro) intro.textContent = 'Build a slip, review verified markets and shape your target odds in one focused workspace.';
    const buttons = document.createElement('div');
    buttons.className = 'aurex-hero-actions';
    const action = document.createElement('button');
    action.type = 'button'; action.className = 'aurex-secondary-cta';
    action.innerHTML = '<span aria-hidden="true">⌁</span> Analyze a booking code <span aria-hidden="true">↗</span>';
    action.addEventListener('click', () => go('analyze'));
    buttons.append(action);
    hero.append(buttons);
    const art = document.createElement('div');
    art.className = 'aurex-hero-visual';
    art.setAttribute('aria-hidden', 'true');
    art.innerHTML = '<div class="aurex-orbit aurex-orbit-one"></div><div class="aurex-orbit aurex-orbit-two"></div><div class="aurex-orbit-core"><span>AX</span></div><div class="aurex-orbit-line"></div>';
    hero.append(art);
  }

  const build = document.querySelector('#build-form');
  if (build) {
    const heading = document.createElement('div');
    heading.className = 'aurex-card-heading';
    heading.innerHTML = '<span class="aurex-card-number">01 / SET YOUR TARGET</span><h2>Build a better slip<span>.</span></h2><p>Choose your sport and enter any valid combined odds.</p>';
    build.prepend(heading);
  }
  const presets = document.querySelector('#build-view .quick-presets');
  if (presets) {
    const note = document.createElement('p');
    note.className = 'aurex-presets-label'; note.textContent = 'QUICK START';
    presets.before(note);
  }
  const analyzeTitle = document.querySelector('#analyze-view .section-title');
  if (analyzeTitle) {
    analyzeTitle.querySelector('h2').textContent = 'One code. A clearer picture.';
    analyzeTitle.querySelector('p:last-child').textContent = 'Import and review your SportyBet code, edit real markets, then generate a fresh code only after verification.';
  }
  const primaryTool = document.querySelector('#read-code-form');
  if (primaryTool) {
    primaryTool.classList.add('aurex-featured-tool');
    const badge = document.createElement('span');
    badge.className = 'aurex-tool-badge'; badge.textContent = 'START HERE';
    primaryTool.prepend(badge);
    const title = primaryTool.querySelector('h3');
    if (title) title.textContent = 'Analyze a booking code';
    const description = primaryTool.querySelector('p');
    if (description) description.textContent = 'Paste a SportyBet code. See score-ranked games, remove weak picks and explore verified alternatives.';
  }
  const slipTitle = document.querySelector('#slip-view .section-title h2');
  if (slipTitle) slipTitle.textContent = 'Your slip, in control.';
  const exploreTitle = document.querySelector('#explore-view .section-title h2');
  if (exploreTitle) exploreTitle.textContent = 'Discover what is live.';

  // Accessible mobile navigation labels and layout only; app.js continues to own all tab state.
  const nav = root.querySelector('.bottom-nav');
  if (nav) nav.setAttribute('aria-label', 'Aurex primary navigation');
}
