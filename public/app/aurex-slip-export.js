// Preview-only utility: export the actual local slip, never authentication tokens.
const actions=document.querySelector('#slip-view .slip-actions');
if(actions&&!document.querySelector('#aurex-share-slip')){
 const button=document.createElement('button');button.id='aurex-share-slip';button.type='button';button.textContent='Share slip ↗';button.setAttribute('aria-label','Share current slip as text');actions.append(button);
 const status=document.createElement('p');status.className='field-help';status.setAttribute('role','status');actions.after(status);
 button.addEventListener('click',async()=>{
  let slip;try{slip=JSON.parse(localStorage.getItem('aurex-active-slip')||'null')}catch{slip=null}
  if(!Array.isArray(slip?.selections)||!slip.selections.length){status.textContent='Build or analyze a slip before sharing.';return}
  const selections=slip.selections.filter(item=>item&&typeof item==='object').slice(0,50);
  const valid=selections.map((item,i)=>`${i+1}. ${String(item.homeTeam||'Team')} vs ${String(item.awayTeam||'Team')} — ${String(item.selectionName||'Selection')} @ ${Number.isFinite(Number(item.odds))?Number(item.odds).toFixed(2):'unavailable'}`);
  const combined=selections.reduce((acc,item)=>acc*Number(item.odds),1);
  const text=['Aurex slip snapshot',...valid,`Combined odds: ${Number.isFinite(combined)?combined.toFixed(2):'unavailable'}`,'Odds may change. AI scores are not win probabilities.'].join('\n');
  try{if(navigator.share){await navigator.share({title:'Aurex slip',text});status.textContent='Share sheet opened.'}else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);status.textContent='Slip copied to clipboard.'}else{status.textContent='Sharing is unavailable in this browser.'}}catch(error){status.textContent=error?.name==='AbortError'?'Share cancelled.':'Unable to share this slip.'}
 });
}
