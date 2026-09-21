// Preview-only skin. Production app.js and existing integrations retain ownership of functionality.
const reset=document.createElement('link');reset.rel='stylesheet';reset.href='/app/aurex-reset.css?v=3.0.0';document.head.append(reset);
const approved=document.createElement('link');approved.rel='stylesheet';approved.href='/app/aurex-white-green.css?v=1.0.0';document.head.append(approved);
const maximalist=document.createElement('link');maximalist.rel='stylesheet';maximalist.href='/app/aurex-maximalist.css?v=1.0.0';document.head.append(maximalist);
void import('./aurex-white-green.js?v=1.0.0').catch(error=>console.error('Aurex white-green preview failed to initialize',error));
const shell=document.querySelector('.app-shell');
const tabs=[...document.querySelectorAll('.bottom-nav button[data-view]')];
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
if(shell&&tabs.length){document.addEventListener('click',event=>{const destination=event.target.closest?.('[data-view],[data-go]');if(!destination)return;const view=destination.dataset.view||destination.dataset.go;const from=tabs.findIndex(tab=>tab.classList.contains('active'));const to=tabs.findIndex(tab=>tab.dataset.view===view);if(from>=0&&to>=0&&from!==to)shell.dataset.navDirection=to>from?'forward':'backward';},{capture:true});}
const estimate=document.querySelector('#estimated-games');if(estimate){let previous=estimate.textContent;new MutationObserver(()=>{const current=estimate.textContent;if(current===previous)return;previous=current;if(reduced.matches)return;estimate.classList.remove('aurex-number-pop');void estimate.offsetWidth;estimate.classList.add('aurex-number-pop');}).observe(estimate,{childList:true,characterData:true,subtree:true});}
