import './score-trim.js?v=6.2.0';
import './code-workspace.js?v=6.2.0';
import './schedule-hints.js?v=5.4.0';
import './sports-extension.js?v=5.5.0';

// This capture handler replaces the old count-only placeholder in app.js.
const codeForm = document.querySelector('#read-code-form');
const codeInput = document.querySelector('#read-code');
const resultPanel = document.querySelector('#analysis-result');
const encode = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const displayOdds = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : 'Unavailable';
let analyzing = false;

if (codeForm && codeInput && resultPanel) {
  const submit = codeForm.querySelector('[type="submit"]');
  const show = (html) => {
    resultPanel.innerHTML = html;
    resultPanel.classList.remove('hidden');
    resultPanel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  };
  codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (analyzing) return;
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(code)) {
      show('<h3>Enter a valid booking code</h3><p>Use 4–20 letters or numbers.</p>');
      return;
    }
    analyzing = true;
    if (submit) { submit.disabled = true; submit.textContent = 'Checking code…'; }
    document.dispatchEvent(new Event('aurex:code-workspace-clear'));
    show('<h3>Analyzing booking code…</h3><p>Verifying fixtures and live markets before reviewing any selection. Unavailable legs will be identified.</p>');
    try {
      const response = await fetch('/api/miniapp/import-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json',
          'x-telegram-init-data': window.Telegram?.WebApp?.initData || '' },
        body: JSON.stringify({ code }), signal: AbortSignal.timeout(55_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'Code import is unavailable. Please try again.');
      if (!Array.isArray(data.selections) || !data.selections.length || !data.summary) {
        throw new Error('A complete provider-backed analysis was not returned. Please try again.');
      }
      const items = [...data.selections].sort((a, b) => b.confidence - a.confidence).map((pick, index) => {
        const verdict = ['keep', 'caution', 'reject'].includes(pick.verdict) ? pick.verdict : 'caution';
        return `<article class="analysis-pick">
          <span class="analysis-verdict ${verdict}">${encode(verdict)}</span>
          <h4>${index + 1}. ${encode(pick.homeTeam)} vs ${encode(pick.awayTeam)}</h4>
          <p class="analysis-market">${encode(pick.marketName)} — ${encode(pick.selectionName)} @ ${displayOdds(pick.odds)}</p>
          <p>${encode(pick.risk)} risk · AI evidence-quality score: ${Math.round(Number(pick.confidence) || 0)}/100 · Rank #${index + 1}</p>
          <p class="analysis-reason">${encode(pick.reason)}</p>
        </article>`;
      }).join('');
      const excluded = Array.isArray(data.excluded) ? data.excluded : [];
      const excludedHtml = excluded.length ? `<section class="analysis-excluded" role="status">
        <h4>${excluded.length} unavailable selection(s) excluded</h4>
        <p>These matches cannot safely be included in a new code. The original code is unchanged.</p>
        ${excluded.map((item) => `<p>${encode(item.index)}. ${encode(item.label)} — ${encode(item.reason)}</p>`).join('')}
      </section>` : '';
      const editableCount = data.editableSlip?.selections?.length || 0;
      show(`<h3>Booking code reviewed · highest score first</h3>
        <p class="analysis-meta">${encode(data.code)} · ${data.selections.length} verified of ${Number(data.count) || data.selections.length} original selections · current verified odds ${displayOdds(data.combinedOdds)}</p>
        <p class="analysis-summary">${encode(data.summary)}</p>${excludedHtml}${items}
        <p class="analysis-disclaimer">${encode(data.disclaimer || 'AI scores are not win probabilities. No bet was placed.')}</p>
        ${editableCount ? `<p class="analysis-summary">${editableCount} qualified selection(s) are ranked below. Enter any valid odds target and tap Rank, trim & generate code; higher-scored picks are considered first and live markets are rechecked.</p>` : '<p class="analysis-warning">No selection qualified for editing. There is no new booking code.</p>'}`);
      document.dispatchEvent(new CustomEvent('aurex:code-analyzed', {
        detail: { code: data.code, analyzedAt: data.analyzedAt, summary: data.summary,
          combinedOdds: data.combinedOdds, selections: data.selections,
          editableSlip: data.editableSlip },
      }));
    } catch (error) {
      const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'Analysis timed out. The original code was not changed. Please try again.'
        : error instanceof Error ? error.message : 'Could not analyze this code.';
      show(`<h3>Could not analyze code</h3><p>${encode(message)}</p><p class="analysis-disclaimer">No analysis has been generated and no bet was placed.</p>`);
    } finally {
      analyzing = false;
      if (submit) { submit.disabled = false; submit.textContent = 'Analyze & edit code'; }
    }
  }, { capture: true });
}
