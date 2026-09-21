/* Visual-only enhancements for the approved Fluid Intelligence direction.
 * The existing Aurex modules own analysis, selection changes and booking-code requests.
 * No demo fixtures, scores, win rates or provider results are introduced here. */
const shell = document.querySelector('.app-shell');
if (shell) {
  document.body.classList.add('aurex-fluid');
  const view = (name) => document.querySelector(`#${name}-tab`)?.click();
  const make = (tag, cls, text) => {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  // Keep the genuine app header and navigation; replace only preview-specific copy.
  const brand = shell.querySelector('.aurex-brand-name');
  if (brand) brand.innerHTML = 'Aure<span>x</span><small>BET SMARTER</small>';
  const previewBadge = shell.querySelector('.aurex-preview-badge');
  if (previewBadge) previewBadge.textContent = '● PREVIEW';
  const brandAction = shell.querySelector('.aurex-header-action');
  if (brandAction) brandAction.textContent = 'Analyze a code ↗';
  const hero = shell.querySelector('#build-view .hero-copy');
  if (hero) {
    hero.classList.add('fluid-build-hero');
    const heading = hero.querySelector('h1');
    if (heading) heading.innerHTML = 'Build <span>smarter slips</span>';
    const description = hero.querySelector('p:last-of-type');
    if (description) description.textContent = 'Set your odds. Review real markets. Create a slip that fits your target.';
    const kicker = hero.querySelector('.aurex-feature-kicker');
    if (kicker) kicker.textContent = '✦  YOUR SPORT INTELLIGENCE WORKSPACE';
    const decor = hero.querySelector('.aurex-hero-visual');
    if (decor) decor.setAttribute('aria-hidden', 'true');
  }
  const form = shell.querySelector('#build-form');
  if (form) {
    form.classList.add('fluid-build-form');
    const lead = form.querySelector('.aurex-card-heading');
    if (lead) {
      lead.querySelector('.aurex-card-number')?.replaceChildren(document.createTextNode('CREATE YOUR SLIP'));
      const h = lead.querySelector('h2');
      if (h) h.textContent = 'Set your target odds';
      const p = lead.querySelector('p');
      if (p) p.textContent = 'Choose a sport and enter any valid decimal target.';
    }
    const primary = form.querySelector('.primary span');
    if (primary) primary.textContent = 'Generate smart slip';
    const sport = form.querySelector('fieldset');
    const odds = form.querySelector('.field:has(#target-odds)');
    const risk = form.querySelector('.field:has(#risk-mode)');
    // Progressive enhancement: labeled layout; do not move live inputs or replace their listeners.
    sport?.classList.add('fluid-sport-field');
    odds?.classList.add('fluid-target-field');
    risk?.classList.add('fluid-risk-field');
  }
  const quick = shell.querySelector('#build-view .quick-presets');
  if (quick && !shell.querySelector('.fluid-extra-presets')) {
    const extras = make('div', 'fluid-extra-presets');
    for (const number of [10, 20]) {
      const button = make('button', '', `${number}.00`);
      button.type = 'button';
      button.setAttribute('aria-label', `Set target odds to ${number}`);
      button.addEventListener('click', () => {
        const odds = shell.querySelector('#target-odds');
        if (!odds) return;
        odds.value = String(number);
        odds.dispatchEvent(new Event('input', { bubbles: true }));
        odds.dispatchEvent(new Event('change', { bubbles: true }));
        quick.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', 'false'));
        extras.querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      });
      extras.append(button);
    }
    quick.after(extras);
    const last = shell.querySelector('.aurex-presets-label');
    if (last) last.textContent = 'QUICK ODDS TARGETS';
  }
  // Build's real slip shortcut: counts and odds come only from the app's state/DOM.
  const buildSteps = shell.querySelector('#build-view .build-steps');
  if (buildSteps && !shell.querySelector('.fluid-slip-shortcut')) {
    const card = make('section', 'fluid-slip-shortcut');
    const left = make('div');
    left.append(make('span', 'fluid-kicker', 'YOUR CURRENT WORKSPACE'));
    const title = make('strong', '', 'Your selections');
    const description = make('small', '', 'Open My Slip to review, edit or generate a code.');
    left.append(title, description);
    const button = make('button', '', 'View picks ↗');
    button.type = 'button'; button.addEventListener('click', () => view('slip'));
    card.append(left, button);
    buildSteps.after(card);
    const badge = shell.querySelector('#slip-count');
    const refresh = () => {
      const count = Number(badge?.textContent || 0);
      title.textContent = Number.isFinite(count) && count > 0 ? `${count} selected pick${count === 1 ? '' : 's'}` : 'No selections yet';
    };
    refresh();
    if (badge) new MutationObserver(refresh).observe(badge, { childList: true, characterData: true, subtree: true });
  }
  // Analyze screen: an animated ornamental orb is NOT presented as a progress indicator.
  const analyze = shell.querySelector('#analyze-view');
  const analyzeTitle = analyze?.querySelector('.section-title');
  if (analyze && analyzeTitle && !analyze.querySelector('.fluid-analyze-orb')) {
    const art = make('div', 'fluid-analyze-orb');
    art.setAttribute('aria-hidden', 'true');
    art.innerHTML = '<span class="fluid-orb-core"></span><span class="fluid-orb-ring fluid-orb-ring-one"></span><span class="fluid-orb-ring fluid-orb-ring-two"></span>';
    analyzeTitle.prepend(art);
    const title = analyzeTitle.querySelector('h2');
    if (title) title.textContent = 'Analyze your slip';
    const subtitle = analyzeTitle.querySelector('p:last-child');
    if (subtitle) subtitle.textContent = 'Paste a SportyBet booking code to review each verified pick, then trim or edit with fresh market data.';
    const status = analyze.querySelector('#analysis-status');
    if (status) {
      const update = () => analyze.classList.toggle('fluid-analyzing', !status.classList.contains('hidden'));
      update();
      new MutationObserver(update).observe(status, { attributes: true, attributeFilter: ['class'] });
    }
  }
  const analyzeButton = analyze?.querySelector('#read-code-form button[type="submit"]');
  if (analyzeButton) analyzeButton.textContent = 'Analyze booking code  →';
  const slipTitle = shell.querySelector('#slip-view .section-title h2');
  if (slipTitle) slipTitle.innerHTML = 'Your <span class="fluid-gradient-text">slip.</span>';
  const slipSubtitle = shell.querySelector('#slip-view .section-title p:last-child');
  if (!slipSubtitle && slipTitle) slipTitle.after(make('p', 'fluid-section-caption', 'Real selections, ranked analysis and live market checks in one place.'));
  const slipSummary = shell.querySelector('#slip-view .slip-summary');
  if (slipSummary && !slipSummary.querySelector('.fluid-wave')) {
    const wave = make('div', 'fluid-wave'); wave.setAttribute('aria-hidden', 'true');
    slipSummary.append(wave);
  }
  const explore = shell.querySelector('#explore-view');
  const exploreTitle = explore?.querySelector('.section-title h2');
  if (exploreTitle) exploreTitle.textContent = 'Explore';
  if (explore && !explore.querySelector('.fluid-explore-feature')) {
    const feature = make('section', 'fluid-explore-feature');
    feature.innerHTML = '<span class="fluid-kicker">✦ FEATURED · AUREX DESK</span><h3>Better research.<br><span>Clearer decisions.</span></h3><p>Explore upcoming fixtures from the connected provider, track matches and revisit your analysis.</p>';
    const action = make('button', '', 'Explore upcoming fixtures  ↗');
    action.type = 'button';
    action.addEventListener('click', () => {
      explore.querySelector('#fixtures-heading')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    });
    feature.append(action);
    explore.querySelector('.section-title')?.after(feature);
    const tabs = make('nav', 'fluid-explore-tabs');
    tabs.setAttribute('aria-label', 'Explore sections');
    for (const [label, target] of [['Fixtures', '#fixtures-heading'], ['Watchlist', '#watch-heading'], ['History', '#history-heading']]) {
      const tab = make('button', '', label);
      tab.type = 'button';
      tab.addEventListener('click', () => explore.querySelector(target)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
      tabs.append(tab);
    }
    feature.before(tabs);
  }
  // Bottom navigation stays connected to the same real tab handlers.
  const labels = { build: 'Build', analyze: 'Analyze', slip: 'My Slip', explore: 'Explore' };
  for (const button of shell.querySelectorAll('.bottom-nav [data-view]')) {
    const label = button.querySelector('.nav-label');
    if (label && labels[button.dataset.view]) label.textContent = labels[button.dataset.view];
  }
}
