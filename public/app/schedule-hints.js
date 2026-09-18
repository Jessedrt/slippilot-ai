// Show the actual Nigeria calendar date; never present tomorrow's fixtures as today's.
const scheduleFetch = window.fetch.bind(window);
let scheduleDay = null;
const heading = document.querySelector('#fixtures-heading');
const deskStatus = document.querySelector('#desk-status');
const buildForm = document.querySelector('#build-form');
const info = buildForm?.querySelector('p.field-help');
if (info) info.textContent = 'AUREX checks today first. If no eligible active SportyBet markets are found, it checks tomorrow, then the following day. Future fixtures are labelled clearly.';
const heroDescription = document.querySelector('#build-view .hero-copy > p:last-child');
if (heroDescription) heroDescription.textContent = 'Set an odds target. AUREX searches available fixtures today, then up to two days ahead only if needed.';
const exploreDescription = document.querySelector('#explore-view .section-title > p:last-child');
if (exploreDescription) exploreDescription.textContent = 'Verified fixture schedules, today-first discovery, your watchlist and research.';
window.fetch = async function aurexScheduleFetch(input, init) {
  const response = await scheduleFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  let path = '';
  try { path = new URL(url, window.location.href).pathname; } catch { /* not a URL */ }
  if (path === '/api/miniapp/fixtures' && response.ok) {
    try {
      const data = await response.clone().json();
      if (typeof data.date === 'string' && Number.isInteger(data.dayOffset)) {
        const names = ["Today's fixtures", "Tomorrow's fixtures", 'Following-day fixtures'];
        scheduleDay = { date: data.date, offset: data.dayOffset };
        if (heading) heading.textContent = names[data.dayOffset] || 'Upcoming fixtures';
      }
    } catch { /* original fixture handler owns error reporting */ }
  }
  return response;
};
if (deskStatus) {
  const update = () => {
    if (!scheduleDay || !deskStatus.textContent?.startsWith('Source:')) return;
    const label = scheduleDay.offset === 0 ? 'Today' :
      scheduleDay.offset === 1 ? 'Tomorrow' : 'Following day';
    const prefix = `${label} · ${scheduleDay.date} WAT · `;
    if (!deskStatus.textContent.startsWith(prefix)) deskStatus.textContent = prefix + deskStatus.textContent;
  };
  new MutationObserver(update).observe(deskStatus, { childList: true, subtree: true });
}
const slipTab = document.querySelector('#slip-tab');
const slipStatus = document.createElement('p');
slipStatus.className = 'desk-note schedule-day-label';
slipStatus.setAttribute('role', 'status');
const insights = document.querySelector('#slip-insights');
insights?.after(slipStatus);
function updateSlipDay() {
  let slip;
  try { slip = JSON.parse(localStorage.getItem('aurex-active-slip') || 'null'); }
  catch { slip = null; }
  if (!slip?.selections?.length) { slipStatus.textContent = ''; return; }
  if (typeof slip.scheduleDate !== 'string' || !Number.isInteger(slip.dayOffset)) {
    slipStatus.textContent = slip.schedule || 'Selection dates appear beside each fixture.';
    return;
  }
  const names = ['Today', 'Tomorrow', 'Following day'];
  const name = names[slip.dayOffset] || 'Selected day';
  slipStatus.textContent = `${name}: ${slip.scheduleDate} (Africa/Lagos). ${slip.dayOffset ? 'No eligible active markets were found on the preceding day(s). These are FUTURE games, not today’s fixtures.' : 'All returned selections were taken from today’s eligible fixtures.'}`;
}
slipTab?.addEventListener('click', updateSlipDay);
const badge = document.querySelector('#slip-count');
if (badge) new MutationObserver(updateSlipDay).observe(badge, { childList: true, subtree: true });
updateSlipDay();
