import './code-workspace.js?v=5.8.0';
import './schedule-hints.js?v=5.4.0';
import './sports-extension.js?v=5.5.0';

// Verified code import replaces the old count-only echo; never call a count an analysis.
const codeForm = document.querySelector('#read-code-form');
const codeInput = document.querySelector('#read-code');
const resultPanel = document.querySelector('#analysis-result');
const statusPanel = document.querySelector('#analysis-status');
const encode = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const displayOdds = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : 'Unavailable';

if (codeForm && codeInput && resultPanel) {
  const submit = codeForm.querySelector('[type="submit"]');
  let running = false;
  const show = (html) => {
    resultPanel.innerHTML = html;
    resultPanel.classList.remove('hidden');
    resultPanel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  };
  const setStatus = (text) => {
    if (!statusPanel) return;
    statusPanel.textContent = text;
    statusPanel.classList.toggle('hidden', !text);
  };
  codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (running) return;
    document.dispatchEvent(new Event('aurex:code-workspace-clear'));
    const code = codeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(code)) {
      show('<h3>Enter a booking code</h3><p>Use a SportyBet booking code containing 4–20 letters or numbers.</p>');
      return;
    }
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) {
      show('<h3>Open in Telegram</h3><p>Launch AUREX from its Telegram Mini App button so the analysis can verify your session. A browser preview cannot import or edit codes.</p>');
      return;
    }
    running = true;
    if (submit) submit.disabled = true;
    setStatus('Verifying the original code, current fixtures and live markets…');
    resultPanel.classList.add('hidden');
    try {
      const response = await fetch('/api/miniapp/import-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ code }), signal: AbortSignal.timeout(55_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'Code import is unavailable. Please try again.');
      if (!Array.isArray(data.selections) || !data.selections.length || !data.summary) {
        throw new Error('A complete provider-backed analysis was not returned. Please try again.');
      }
      const items = data.selections.map((pick, index) => {
        const verdict = ['keep', 'caution', 'reject'].includes(pick.verdict) ? pick.verdict : 'caution';
        return `<article class="analysis-pick">
          <span class="analysis-verdict ${verdict}">${encode(verdict)}</span>
          <h4>${index + 1}. ${encode(pick.homeTeam)} vs ${encode(pick.awayTeam)}</h4>
          <p class="analysis-market">${encode(pick.marketName)} — ${encode(pick.selectionName)} @ ${displayOdds(pick.odds)}</p>
          <p>${encode(pick.risk)} risk · AI evidence-quality score: ${Math.round(Number(pick.confidence) || 0)}/100</p>
          <p class="analysis-reason">${encode(pick.reason)}</p>
        </article>`;
      }).join('');
      const excluded = Array.isArray(data.excluded) ? data.excluded : [];
      const excludedHtml = excluded.length ? `<section class="analysis-excluded" role="note">
        <h4>${excluded.length} unavailable selection(s) excluded</h4>
        <p>These picks were not analyzed or placed in the editable slip:</p>
        ${excluded.map((pick) => `<p><strong>${encode(pick.fixture)}</strong> — ${encode(pick.reason)}</p>`).join('')}
      </section>` : '';
      const editableCount = data.editableSlip?.selections?.length || 0;
      show(`<h3>Booking code reviewed</h3>
        <p class="analysis-meta">${encode(data.code)} · ${data.selections.length} of ${Number(data.originalCount) || data.selections.length} selections reviewed · active-market odds ${displayOdds(data.combinedOdds)}</p>
        ${excludedHtml}
        <p class="analysis-summary">${encode(data.summary)}</p>${items}
        <p class="analysis-disclaimer">${encode(data.disclaimer || 'AI scores are not win probabilities. No bet was placed.')}</p>
        ${editableCount ? `<p class="analysis-summary">${editableCount} qualifying selection(s) are available for editing below. All changes require a fresh AI review.</p>` : '<p class="analysis-warning">No qualifying selection is available for editing.</p>'}`);
      document.dispatchEvent(new CustomEvent('aurex:code-analyzed', {
        detail: { code: data.code, analyzedAt: data.analyzedAt, summary: data.summary,
          combinedOdds: data.combinedOdds, selections: data.selections,
          editableSlip: data.editableSlip },
      }));
      setStatus(`${data.selections.length} live selection(s) reviewed${excluded.length ? `; ${excluded.length} outdated selection(s) excluded` : ''}.`);
    } catch (error) {
      const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'Analysis timed out. Try a smaller, current code; no bet was placed.'
        : error instanceof Error ? error.message : 'Could not analyze this code.';
      show(`<h3>Could not analyze code</h3><p>${encode(message)}</p><p class="analysis-disclaimer">No analysis has been generated and no bet was placed.</p>`);
      setStatus('Analysis could not be completed.');
    } finally {
      running = false;
      if (submit) submit.disabled = false;
    }
  }, { capture: true });
}
