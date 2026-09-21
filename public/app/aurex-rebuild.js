// Aurex 4.0: a real DOM reconstruction, not an overlay of the rejected skins.
// Preserve the original form, result, navigation and provider nodes so the existing
// handlers, signed analysis, watchlist and booking-code flow remain authoritative.
const shell = document.querySelector('.app-shell');
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const make = (tag, className = '', text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const svg = (name) => ({ search:'<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>', arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>', sparkle:'<path d="m12 2 2.1 7.9L22 12l-7.9 2.1L12 22l-2.1-7.9L2 12l7.9-2.1Z"/>', ball:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 4 5 14 0 18M12 3C7 7 7 17 12 21"/>', chart:'<path d="M4 17l5-5 4 3 7-9M4 4v16h16"/>', copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>', bookmark:'<path d="M6 3h12v18l-6-4-6 4Z"/>' })[name] || '';
function symbol(name) { const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = svg(name); return el; }
function button(text, className, handler) { const el = make('button', className, text); el.type = 'button'; if (handler) el.addEventListener('click', handler); return el; }
const navigate = (screen) => $(`.bottom-nav [data-view="${screen}"]`)?.click();
function heading(title, action, handler) { const line = make('div', 'ax-heading'); line.append(make('h2', '', title)); if (action) { const link = button(action + ' ↗', 'ax-link', handler); line.append(link); } return line; }
function alertText(text) { const p = make('p', 'ax-empty-note', text); p.setAttribute('role', 'status'); return p; }

if (shell && !$('.ax-topbar')) {
  document.documentElement.classList.add('aurex-rebuilt');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f7fbf8');
  window.Telegram?.WebApp?.setHeaderColor?.('#f7fbf8');
  window.Telegram?.WebApp?.setBackgroundColor?.('#f7fbf8');
  const header = make('header', 'ax-topbar');
  const branding = make('div', 'ax-branding');
  const brand = make('strong', 'ax-logo'); brand.append('Aurex', make('span', '', '✦'));
  branding.append(brand, make('small', '', 'Smarter Bets. Sharper Insights.'));
  const headerButtons = make('div', 'ax-header-actions');
  const about = button('ⓘ', 'ax-icon-btn', () => {
    const panel = $('#ax-about'); panel.hidden = !panel.hidden; about.setAttribute('aria-expanded', String(!panel.hidden));
  });
  about.setAttribute('aria-label', 'Show Aurex connection and data information'); about.setAttribute('aria-expanded', 'false');
  headerButtons.append(about);
  const badge = make('span', 'ax-avatar', 'A'); badge.setAttribute('aria-label', 'Aurex'); headerButtons.append(badge);
  header.append(branding, headerButtons);
  const info = make('aside', 'ax-about'); info.id = 'ax-about'; info.hidden = true;
  info.append(make('strong', '', 'Aurex intelligence desk'), make('p', '', 'Live fixtures, betting-code analysis and code generation require the Telegram Mini App and configured provider access. Odds and AI evidence scores are not win probabilities. No bet is placed by Aurex.'));
  shell.prepend(header, info);

  const build = $('#build-view');
  const hero = $('.hero-copy', build);
  if (hero) { $('.eyebrow', hero)?.remove(); const h = $('h1', hero); if (h) h.innerHTML = 'Build<br>Smarter <span>Slips</span>'; const p = $('p', hero); if (p) p.textContent = 'AI-powered insights. Real data. Better decisions.'; }
  const steps = $('.build-steps', build); if (steps) steps.hidden = true;
  const search = make('label', 'ax-search'); search.append(symbol('search'));
  const searchInput = make('input'); searchInput.type = 'search'; searchInput.placeholder = 'Search teams, leagues, or matches…'; searchInput.setAttribute('aria-label', 'Find real provider fixtures'); search.append(searchInput);
  searchInput.addEventListener('focus', () => { navigate('explore'); const target = $('#ax-fixture-search'); if (target) { target.value = searchInput.value; target.dispatchEvent(new Event('input')); target.focus(); } });
  hero?.after(search);
  const sports = make('section', 'ax-sports'); sports.setAttribute('aria-label', 'Available sports');
  const sportOptions = [ ['football', '⚽', 'Football'], ['basketball', '🏀', 'Basketball'], ['tennis', '🎾', 'Tennis'], ['handball', '🤾', 'Handball'] ];
  sportOptions.forEach(([id, emoji, label]) => {
    const control = button('', 'ax-sport', () => { const radio = $(`#build-form input[name="sport"][value="${id}"]`); if (!radio) return; radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); $$('.ax-sport', sports).forEach(b => b.setAttribute('aria-pressed', String(b === control))); });
    control.append(make('span', 'ax-sport-icon', emoji), make('span', '', label)); control.setAttribute('aria-pressed', String(id === 'football')); sports.append(control);
  });
  const more = button('', 'ax-sport', () => { navigate('explore'); $('#ax-fixture-search')?.focus(); }); more.append(make('span', 'ax-sport-icon', '•••'), make('span', '', 'More')); sports.append(more);
  search.after(sports);
  const originals = $('#build-form fieldset'); if (originals) { originals.classList.add('ax-original-sport-field'); originals.setAttribute('aria-label', 'Sport selection synced with sport buttons above'); }
  build.querySelectorAll('#build-form input[name="sport"]').forEach(radio => radio.addEventListener('change', () => $$('.ax-sport', sports).forEach(b => b.setAttribute('aria-pressed', String(b.textContent.trim().toLowerCase().includes(radio.value))))));

  const highlights = make('section', 'ax-highlights'); highlights.append(heading("Today's Highlights", 'View all', () => navigate('explore')));
  const highlightRows = make('div', 'ax-highlights-list'); highlightRows.append(alertText('Verified upcoming fixtures appear here after Explore loads. Open Aurex in Telegram to request live provider data.')); highlights.append(highlightRows); sports.after(highlights);
  const fixtures = $('#desk-fixtures');
  function renderHighlights() {
    if (!fixtures) return;
    const rows = $$('.desk-row', fixtures).slice(0, 4);
    highlightRows.replaceChildren();
    if (!rows.length) { highlightRows.append(alertText('No verified fixtures loaded. Tap View all to check your provider.')); return; }
    rows.forEach(row => { const card = button('', 'ax-match-card', () => navigate('explore')); const text = make('span', 'ax-match-copy'); text.append(make('strong', '', row.querySelector('strong')?.textContent || 'Fixture'), make('small', '', row.querySelector('small')?.textContent || 'Provider fixture')); card.append(make('span', 'ax-match-symbol', '⚽'), text, make('span', 'ax-match-chevron', '›')); highlightRows.append(card); });
  }
  if (fixtures) { new MutationObserver(renderHighlights).observe(fixtures, { childList: true, subtree: true, characterData: true }); renderHighlights(); }
  const presets = $('.quick-presets', build); if (presets) { presets.before(heading('Quick targets')); }
  const promo = make('section', 'ax-build-promo'); const promoText = make('div'); promoText.append(make('span', 'ax-promo-kicker', '✦ PERSONALIZED INTELLIGENCE'), make('h2', '', 'Let Aurex Build for You'), make('p', '', 'Choose a target and generate a reviewed slip using available markets.'));
  promo.append(make('span', 'ax-promo-dice', '✦'), promoText, button('Generate slip →', 'ax-promo-button', () => { $('#build-form')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' }); $('#target-odds')?.focus({ preventScroll: true }); }));
  highlights.after(promo);
  const buildForm = $('#build-form'); if (buildForm) { const formTitle = heading('Create your slip'); buildForm.before(formTitle); }
  $('.help-panel', build)?.classList.add('ax-after-help');

  const analyze = $('#analyze-view');
  const analyzeTitle = $('.section-title', analyze); if (analyzeTitle) { analyzeTitle.innerHTML = '<span class="ax-page-kicker">YOUR INTELLIGENCE STUDIO</span><h1>Analyze with <em>Aurex.</em></h1><p>Review verified codes, screenshots and public posts. Make informed changes.</p>'; }
  const analyzeTabs = make('div', 'ax-subtabs'); analyzeTabs.setAttribute('role', 'tablist'); analyzeTabs.setAttribute('aria-label', 'Analysis sources');
  const analyzeItems = [['Booking code', '#read-code-form'], ['X post', '#x-form'], ['Screenshot', '#shot-form'], ['AI chat', null]];
  const forms = analyzeItems.map(([, selector]) => selector ? $(selector, analyze) : null);
  const chatHint = alertText('Analyze a booking code first. When verified selections are available, the conversational editor will appear below the results.'); chatHint.id = 'ax-chat-hint'; chatHint.hidden = true;
  analyzeItems.forEach(([label, selector], index) => { const tab = button(label, 'ax-subtab', () => {
    $$('.ax-subtab', analyzeTabs).forEach((item, i) => { item.setAttribute('aria-selected', String(i === index)); item.tabIndex = i === index ? 0 : -1; });
    forms.forEach((form, i) => { if (form) form.hidden = i !== index; });
    chatHint.hidden = index !== 3;
    if (index === 3 && !$('.aurex-conversation:not(.hidden)', analyze)) chatHint.hidden = false;
    if (index === 3) $('.aurex-conversation:not(.hidden)', analyze)?.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(index === 0)); tab.tabIndex = index === 0 ? 0 : -1; analyzeTabs.append(tab); if (index > 0 && forms[index]) forms[index].hidden = true; });
  $('.tool-grid', analyze)?.before(analyzeTabs); $('.tool-grid', analyze)?.after(chatHint);
  const recent = make('section', 'ax-recent'); recent.append(heading('Recent Analyses', 'Explore history', () => navigate('explore'))); const recentList = make('div', 'ax-recent-list'); recent.append(recentList);
  function renderRecent() { const entries = $$('.desk-history-entry', $('#history-items') || document).slice(0, 3); recentList.replaceChildren(); if (!entries.length) { recentList.append(alertText('No saved analyses yet. Review a booking code to start your history.')); return; } entries.forEach(entry => { const item = button('', 'ax-recent-row', () => { navigate('explore'); activateExplore('insights'); }); item.append(make('span', 'ax-recent-glyph', '✦'), make('span', 'ax-recent-name', entry.querySelector('summary')?.textContent || 'Analysis'), make('span', 'ax-recent-view', 'View')); recentList.append(item); }); }
  const historyItems = $('#history-items'); if (historyItems) new MutationObserver(renderRecent).observe(historyItems, {childList:true,subtree:true}); renderRecent();
  const analyzeFeature = make('section', 'ax-analyze-feature'); analyzeFeature.append(make('span', 'ax-feature-orb', '✧'), make('strong', '', 'AI. Data. Edge.'), make('p', '', 'Turn verified information into clearer decisions.')); analyzeFeature.append(button('Explore fixtures ↗', '', () => navigate('explore'))); analyze.append(recent, analyzeFeature);

  const slip = $('#slip-view'); const slipTitle = $('.section-title', slip); if (slipTitle) slipTitle.innerHTML = '<span class="ax-page-kicker">YOUR WORKSPACE</span><h1>My <em>Slip.</em></h1><p>Review your actual selections before generating a booking code.</p>';
  const slipTabs = make('div', 'ax-subtabs ax-slip-tabs'); slipTabs.setAttribute('role','tablist'); slipTabs.setAttribute('aria-label','Slip sections');
  const current = button('Current slip', 'ax-subtab', () => selectSlip(false)); const past = button('History', 'ax-subtab', () => selectSlip(true)); slipTabs.append(current,past);
  const slipHistory = make('section', 'ax-slip-history'); slipHistory.hidden = true; slipHistory.append(heading('Previous analyses')); const slipHistoryRows = make('div'); slipHistory.append(slipHistoryRows);
  function showHistory() { slipHistoryRows.replaceChildren(); const entries = $$('.desk-history-entry', $('#history-items') || document); if (!entries.length) {slipHistoryRows.append(alertText('No saved analyses on this device yet.'));return;} entries.forEach(entry=>slipHistoryRows.append(entry.cloneNode(true))); }
  function selectSlip(history) { slipHistory.hidden = !history; $('#empty-slip').hidden = history; $('#slip-content').hidden = history; $('#code-result').hidden = history; [current,past].forEach((btn,i)=>btn.setAttribute('aria-selected',String(Boolean(i)===history))); if(history)showHistory(); }
  current.setAttribute('aria-selected','true'); past.setAttribute('aria-selected','false'); slipTitle?.after(slipTabs); $('#code-result')?.after(slipHistory);
  const summary = $('.slip-summary', slip); if(summary) { const calculator = make('div', 'ax-stake'); const label = make('label'); label.setAttribute('for','ax-stake-input'); label.textContent='Stake (₦)'; const input = make('input'); input.id='ax-stake-input';input.type='number';input.min='0';input.max='1000000000';input.step='100';input.inputMode='decimal';input.placeholder='Enter stake'; const output=make('div','ax-return');output.append(make('small','','Potential gross return'),make('strong','','—')); calculator.append(label,input,output); summary.after(calculator);
    const recalc=()=>{const odds=Number($('#combined-odds')?.textContent); const value=Number(input.value); const result=$('strong',output); result.textContent=input.value && Number.isFinite(odds)&&odds>0&&Number.isFinite(value)&&value>=0&&value<=1e9 ? '₦'+(odds*value).toLocaleString('en-NG',{maximumFractionDigits:2}) : '—';}; input.addEventListener('input',recalc); const oddsNode=$('#combined-odds'); if(oddsNode)new MutationObserver(recalc).observe(oddsNode,{childList:true,characterData:true,subtree:true}); recalc(); }
  const pickList = $('#pick-list'); if(pickList) { const add = button('＋ Add more selections', 'ax-add-selections', () => navigate('build')); pickList.after(add); }
  $('#slip-tab')?.addEventListener('click',()=>selectSlip(false));

  const explore = $('#explore-view'); const exploreTitle = $('.section-title',explore); if (exploreTitle) exploreTitle.innerHTML='<span class="ax-page-kicker">DISCOVER YOUR EDGE</span><h1>Explore<span class="ax-green-star">✦</span></h1><p>Live fixtures, tracked matches and your own verified research.</p>';
  const exploreTabs = make('div','ax-subtabs ax-explore-tabs'); exploreTabs.setAttribute('role','tablist'); exploreTabs.setAttribute('aria-label','Explore categories');
  const panels = $$('.desk-panel',explore); const shortcuts=$('.desk-shortcuts',explore);
  const guides = make('section','ax-guides'); guides.hidden=true; guides.append(heading('Tools & resources'));
  const guideGrid=make('div','ax-guide-grid'); const guideData=[['⚖','Stake calculator','slip'],['✦','Strategy builder','build'],['⌕','Review a booking code','analyze'],['◎','Odds watchlist','watchlist']];
  guideData.forEach(([icon,label,to])=>{const card=button('', 'ax-guide-card',()=>to==='watchlist'?activateExplore('watchlist'):navigate(to));card.append(make('span','ax-guide-icon',icon),make('strong','',label),make('span','', '↗'));guideGrid.append(card);}); guides.append(guideGrid);
  guides.append(make('h3','', 'A note on responsible analysis'),make('p','ax-guide-note','Odds can change. Correlated selections add risk. Use real provider markets, set a spending limit and do not treat an AI quality score as a probability of winning.'));
  const promoExplore=make('section','ax-explore-promo');promoExplore.append(make('span','ax-explore-art','✦'),make('h2','','Stay Ahead'),make('p','','Your verified fixtures, watchlist and research — all in one place.'));promoExplore.append(button('Explore matches →','',()=>activateExplore('fixtures')));
  const trends=make('section','ax-trending');trends.append(heading('Trending Leagues'));const leagueList=make('div','ax-leagues');trends.append(leagueList);
  function renderLeagues(){leagueList.replaceChildren();const names=new Map();$$('.desk-row strong',fixtures||document).forEach(()=>{}); $$('.desk-row small',fixtures||document).forEach(item=>{const league=item.textContent?.split(' · ')[0]?.trim();if(league)names.set(league,(names.get(league)||0)+1);}); if(!names.size){leagueList.append(alertText('Leagues appear after live fixtures load.'));return;} [...names].sort((a,b)=>b[1]-a[1]).slice(0,6).forEach(([league,count])=>{const card=button('', 'ax-league',()=>{activateExplore('fixtures');const target=$('#ax-fixture-search');if(target){target.value=league;target.dispatchEvent(new Event('input'));}}); card.append(make('span','ax-league-icon','⚽'),make('strong','',league),make('small','',`${count} fixture${count===1?'':'s'}`));leagueList.append(card);});}
  if(fixtures)new MutationObserver(renderLeagues).observe(fixtures,{childList:true,subtree:true,characterData:true}); renderLeagues();
  const latest=make('section','ax-latest');latest.append(heading('Latest Insights','See history',()=>activateExplore('insights')));const insightsList=make('div','ax-latest-list');latest.append(insightsList);
  function renderInsights(){insightsList.replaceChildren();const entries=$$('.desk-history-entry',historyItems||document).slice(0,3);if(!entries.length){insightsList.append(alertText('Your verified analyses will appear here. No articles or predictions are invented.'));return;} entries.forEach(entry=>{const card=button('', 'ax-insight',()=>activateExplore('insights'));card.append(make('span','ax-insight-art','✦'),make('span','ax-insight-copy',entry.querySelector('summary')?.textContent||'Saved analysis'),make('span','','↗'));insightsList.append(card);});} if(historyItems)new MutationObserver(renderInsights).observe(historyItems,{childList:true,subtree:true});renderInsights();
  function activateExplore(key){$$('.ax-explore-tabs .ax-subtab').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.section===key)));panels.forEach((panel,i)=>panel.hidden= key==='fixtures'?i!==0:key==='watchlist'?i!==1:key==='insights'?i!==2:true);promoExplore.hidden=key!=='fixtures';trends.hidden=key!=='fixtures';latest.hidden=key!=='fixtures';guides.hidden=key!=='guides';if(shortcuts)shortcuts.hidden=key!=='fixtures';}
  [['fixtures','Explore'],['watchlist','Watchlist'],['insights','Insights'],['guides','Guides']].forEach(([key,label])=>{const tab=button(label,'ax-subtab',()=>activateExplore(key));tab.dataset.section=key;tab.setAttribute('role','tab');exploreTabs.append(tab);});
  exploreTitle?.after(exploreTabs,promoExplore,trends,latest);explore.append(guides);activateExplore('fixtures');
  const fixturePanel=panels[0];if(fixturePanel&&fixtures){const fixtureSearch=make('label','ax-search ax-explore-search');fixtureSearch.append(symbol('search'));const input=make('input');input.id='ax-fixture-search';input.type='search';input.placeholder='Search available teams and leagues';input.setAttribute('aria-label','Filter actual provider fixtures');fixtureSearch.append(input);fixtures.before(fixtureSearch);
    const filter=()=>{const query=input.value.trim().toLowerCase();$$('.desk-row',fixtures).forEach(row=>row.hidden=Boolean(query)&&!row.textContent.toLowerCase().includes(query));};input.addEventListener('input',filter);new MutationObserver(filter).observe(fixtures,{childList:true}); }
  // The preview is fully navigable outside Telegram; backend requests are still authenticated.
  if(!window.Telegram?.WebApp?.initData){const state=make('div','ax-connection-notice');state.append(make('span','','ⓘ'),make('p','','Design preview: live fixtures and AI analysis require opening Aurex from its Telegram bot with a configured Preview backend. Browse the interface without fabricated data.'));exploreTitle?.after(state);}

  const nav=$('.bottom-nav'); if(nav){const orb=button('', 'ax-orb',()=>navigate('analyze'));orb.append(symbol('sparkle'));orb.setAttribute('aria-label','Quick access to Aurex analysis');nav.children[1]?.after(orb);}
  const labels={build:'Build',analyze:'Analyze',slip:'My Slip',explore:'Explore'};$$('.bottom-nav [data-view]').forEach(item=>{const label=$('.nav-label',item);if(label)label.textContent=labels[item.dataset.view]||label.textContent;});
}
