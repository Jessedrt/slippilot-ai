// Replace only the old code-echo handler. The other analysis forms and slip
// builder retain their existing logic. Never manufacture an AI review on failure.
const codeForm = document.querySelector('#read-code-form');
const codeInput = document.querySelector('#read-code');
const resultPanel = document.querySelector('#analysis-result');
const encode = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const displayOdds = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : 'Unavailable';

if (codeForm && codeInput && resultPanel) {
  codeForm.addEventListener('submit', async (event) => {
    // Capture listener prevents the original app.js handler from calling the
    // count-only /read-code route and painting over this full analysis.
    event.preventDefault();
    event.stopImmediatePropagation();
    const code = codeInput.value.trim().toUpperCase();
    const show = (html) => {
      resultPanel.innerHTML = html;
      resultPanel.classList.remove('hidden');
      resultPanel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    };
    try {
      const response = await fetch('/api/miniapp/analyze-code', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-init-data': window.Telegram?.WebApp?.initData || '',
        },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(55_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'Analysis is unavailable. Please try again.');
      if (!Array.isArray(data.selections) || !data.selections.length || !data.summary) {
        throw new Error('A full analysis was not returned. Please try again.');
      }
      const items = data.selections.map((pick, index) => {
        const verdict = ['keep', 'caution', 'reject'].includes(pick.verdict) ? pick.verdict : 'caution';
        const available = pick.status === 'active' && pick.eventStatus === 'scheduled';
        return `<article class="analysis-pick">
          <span class="analysis-verdict ${verdict}">${encode(verdict)}</span>
          <h4>${index + 1}. ${encode(pick.homeTeam)} vs ${encode(pick.awayTeam)}</h4>
          <p class="analysis-market">${encode(pick.marketName)} — ${encode(pick.selectionName)} @ ${displayOdds(pick.odds)}</p>
          <p>${encode(pick.risk)} risk · AI evidence-quality score: ${Math.round(Number(pick.confidence) || 0)}/100</p>
          <p class="analysis-reason">${encode(pick.reason)}</p>
          ${available ? '' : '<p class="analysis-warning">Fixture or market may no longer be available.</p>'}
        </article>`;
      }).join('');
      show(`<h3>Booking code analyzed</h3>
        <p class="analysis-meta">${encode(data.code)} · ${data.selections.length} selections · current combined odds ${displayOdds(data.combinedOdds)}</p>
        <p class="analysis-summary">${encode(data.summary)}</p>
        ${items}
        <p class="analysis-disclaimer">${encode(data.disclaimer || 'AI scores are not winning probabilities. No bet was placed.')}</p>`);
    } catch (error) {
      const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'Analysis timed out. Please try again; no bet was placed.'
        : error instanceof Error ? error.message : 'Could not analyze this code.';
      show(`<h3>Could not analyze code</h3><p>${encode(message)}</p><p class="analysis-disclaimer">No analysis has been generated and no bet was placed.</p>`);
    }
  }, { capture: true });
}
