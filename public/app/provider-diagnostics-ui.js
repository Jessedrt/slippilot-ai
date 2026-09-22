// Diagnostics are user-triggered: do not spend API calls automatically on every page load.
// This module never receives the API key; the existing Telegram-signed backend performs checks.
const buildError = document.querySelector('#build-error');
if (buildError) {
  const panel = document.createElement('details');
  panel.className = 'provider-diagnostics';
  panel.style.cssText =
    'margin:16px 0 24px;padding:16px;border:1px solid rgba(0,123,70,.18);border-radius:16px;background:rgba(230,249,239,.52);color:#193c30';
  const summary = document.createElement('summary');
  summary.textContent = 'API-Sports connection & configuration';
  summary.style.cssText = 'cursor:pointer;font-weight:750;font-size:.94rem';
  const introduction = document.createElement('p');
  introduction.textContent =
    'Check football and basketball access separately. A connected API does not guarantee fixture coverage, betting permissions or successful picks.';
  introduction.style.cssText = 'font-size:.83rem;line-height:1.5;margin:12px 0';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Check API connection';
  button.style.cssText =
    'border:0;border-radius:12px;background:#007e4c;color:white;padding:12px 16px;font:inherit;font-weight:700;cursor:pointer';
  const coverageButton = document.createElement('button');
  coverageButton.type = 'button';
  coverageButton.textContent = 'Test selected sport fixture coverage';
  coverageButton.style.cssText =
    'margin-left:8px;border:1px solid #86bda6;border-radius:12px;background:#f5fcf8;color:#126846;padding:11px 14px;font:inherit;font-weight:700;cursor:pointer';
  const output = document.createElement('div');
  output.setAttribute('role', 'status');
  output.setAttribute('aria-live', 'polite');
  output.style.cssText =
    'font-size:.82rem;line-height:1.55;margin-top:12px;white-space:pre-line;overflow-wrap:anywhere';
  panel.append(summary, introduction, button, coverageButton, output);
  buildError.after(panel);

  button.addEventListener('click', async () => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) {
      output.textContent =
        'Open Aurex from its Telegram Mini App launcher to check the backend connection.';
      return;
    }
    button.disabled = true;
    output.textContent = 'Checking both provider products…';
    try {
      const response = await fetch('/api/miniapp/provider-status', {
        headers: { 'x-telegram-init-data': initData },
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) {
        output.textContent =
          response.status === 401
            ? 'Telegram session expired. Reopen the Mini App and retry.'
            : `Connection check could not complete (HTTP ${response.status}). No selections were created.`;
        return;
      }
      const status = await response.json();
      const report = (product) => {
        if (!product || typeof product !== 'object') return 'Provider status unavailable.';
        const name = product.product === 'football' ? 'Football' : 'Basketball';
        const state =
          typeof product.state === 'string' ? product.state.replace(/_/g, ' ') : 'unknown';
        const message =
          typeof product.message === 'string' ? product.message : 'No provider details available.';
        const usage =
          Number.isSafeInteger(product.requestsToday) && Number.isSafeInteger(product.dailyLimit)
            ? ` Account requests: ${product.requestsToday}/${product.dailyLimit}.`
            : '';
        const activation =
          product.analysisEnabled === true
            ? 'Analysis enabled.'
            : `Analysis disabled${product.activationBlock ? ` (${String(product.activationBlock).replace(/_/g, ' ')})` : ''}.`;
        const fixture = product.operational?.fixtureRetrieval;
        const statistics = product.operational?.statisticsRetrieval;
        const latest = product.operational?.latestAnalysis;
        const operational = [
          `Fixture retrieval: ${fixture?.tested ? (fixture.succeeded ? `passed via ${fixture.source || 'provider'}` : `failed (${fixture.reason || 'unknown reason'})`) : 'not tested on this server instance'}.`,
          `Statistics retrieval: ${statistics?.tested ? (statistics.succeeded ? `passed via ${statistics.source || 'provider'}` : `failed (${statistics.reason || 'unknown reason'})`) : 'not tested on this server instance'}.`,
          `Latest verified analysis: ${latest?.tested ? (latest.succeeded ? `${latest.verifiedSelections || 0} approved selection(s)` : 'no approved API-Sports selection') : 'not recorded on this server instance'}.`,
        ].join(' ');
        const rights =
          product.dataRightsConfirmed === true
            ? 'Data-rights confirmation flag is present; status authentication still does not prove legal rights.'
            : 'Competition publication/betting-analysis rights are not confirmed.';
        return `${name}: ${state}. ${activation} ${message}${usage} ${operational} ${rights}`;
      };
      output.textContent = `${report(status.football)}\n\n${report(status.basketball)}\n\nConnection, activation, fixture identity, statistics and selection approval are separate checks.`;
    } catch {
      output.textContent =
        'Could not reach the diagnostics endpoint. Check your connection or retry later.';
    } finally {
      button.disabled = false;
    }
  });

  coverageButton.addEventListener('click', async () => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) {
      output.textContent =
        'Open Aurex from its Telegram Mini App launcher to test fixture coverage.';
      return;
    }
    const sport = document.querySelector('#build-form input[name="sport"]:checked')?.value;
    if (sport !== 'football' && sport !== 'basketball') {
      output.textContent = 'Select football or basketball before testing fixture coverage.';
      return;
    }
    coverageButton.disabled = true;
    output.textContent = `Testing up to 10 real ${sport} fixtures. This consumes provider quota but creates no slip or booking code…`;
    try {
      const response = await fetch('/api/miniapp/provider-coverage', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ sport, maximumFixtures: 10 }),
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        output.textContent =
          data.message ||
          `Coverage test failed (HTTP ${response.status}). No selections were created.`;
        return;
      }
      const report = data.report;
      output.textContent = `${sport === 'football' ? 'Football' : 'Basketball'} fixture coverage test: ${report.mapped}/${report.total} mapped (${report.coveragePercentage}%). Unmapped: ${report.unmapped}; ambiguous: ${report.ambiguous}; kickoff mismatch: ${report.kickoffMismatches}; invalid status: ${report.invalidStatuses}; reversed home/away: ${report.orientationMismatches}; unsupported competitions: ${report.unsupportedCompetitions}. This does not test historical statistics or grant data rights.`;
    } catch (error) {
      output.textContent =
        error?.name === 'TimeoutError'
          ? 'Fixture coverage test timed out. No selections were created.'
          : 'Could not complete the fixture coverage test. Retry later.';
    } finally {
      coverageButton.disabled = false;
    }
  });
}
