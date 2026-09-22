const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.('#07110f');
tg?.setBackgroundColor?.('#07110f');

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let gameCount = 5;
let todayOnly = false;
let slip = loadStoredSlip();

function loadStoredSlip() {
  try {
    const value = JSON.parse(
      localStorage.getItem('aurex-active-slip') ||
        localStorage.getItem('slippilot-active-slip') ||
        'null',
    );
    if (value && Array.isArray(value.selections) && value.analysisToken) return value;
    localStorage.removeItem('slippilot-active-slip');
    return null;
  } catch {
    localStorage.removeItem('slippilot-active-slip');
    localStorage.removeItem('aurex-active-slip');
    return null;
  }
}

function updateConnectionState() {
  const label = $('.live-pill');
  label.innerHTML = navigator.onLine ? '<i></i> READY' : '<i></i> OFFLINE';
  label.classList.toggle('offline', !navigator.onLine);
}
window.addEventListener('online', updateConnectionState);
window.addEventListener('offline', updateConnectionState);

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 1800);
}

function switchView(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${name}-view`));
  $$('.bottom-nav button').forEach((button) =>
    button.classList.toggle('active', button.dataset.view === name),
  );
  if (name === 'slip') renderSlip();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function api(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': tg?.initData || '' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('This is taking too long. Nothing was booked—please try again.');
    }
    throw new Error('Connection lost. Check your internet and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.message || data.error || 'Something went wrong. Please try again.',
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function saveSlip(nextSlip) {
  slip = nextSlip;
  if (slip) localStorage.setItem('aurex-active-slip', JSON.stringify(slip));
  else localStorage.removeItem('aurex-active-slip');
  localStorage.removeItem('slippilot-active-slip');
  $('#slip-count').textContent = slip?.selections?.length || 0;
}

function renderSlip() {
  const selections = slip?.selections || [];
  $('#empty-slip').classList.toggle('hidden', selections.length > 0);
  $('#slip-content').classList.toggle('hidden', selections.length === 0);
  $('#slip-count').textContent = selections.length;
  if (!selections.length) return;
  const odds = selections.reduce((total, pick) => total * pick.odds, 1);
  const confidence =
    selections.reduce((total, pick) => total + (pick.evidenceQualityScore ?? pick.confidence), 0) /
    selections.length;
  $('#combined-odds').textContent = odds.toFixed(2);
  $('#average-confidence').textContent = `${Math.round(confidence)}/100`;
  $('#pick-list').innerHTML = selections
    .map(
      (pick, index) => `
    <article class="pick-row">
      <span class="pick-num">${String(index + 1).padStart(2, '0')}</span>
      <div><h3>${escapeHtml(pick.homeTeam)} vs ${escapeHtml(pick.awayTeam)}</h3><p>${escapeHtml(pick.selectionName)} · SportyBet odds ${pick.odds.toFixed(2)}${pick.statisticalProjection == null ? '' : ` · statistical projection ${Number(pick.statisticalProjection).toFixed(1)}`}${pick.verifiedStatisticsSource ? ` · ${escapeHtml(pick.verifiedStatisticsSource)} stats retrieved ${escapeHtml(new Date(pick.statisticsRetrievedAt).toLocaleString())}` : ''}${pick.missingData?.length ? ` · missing: ${escapeHtml(pick.missingData.join(' '))}` : ''}</p></div>
      <div class="pick-score">${Math.round(pick.evidenceQualityScore ?? pick.confidence)}/100<small>evidence · ${escapeHtml(pick.risk)} risk</small></div>
      <button data-remove="${index}">Remove</button>
    </article>`,
    )
    .join('');
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

function showResult(target, html) {
  target.innerHTML = html;
  target.classList.remove('hidden');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$$('.bottom-nav button').forEach((button) =>
  button.addEventListener('click', () => switchView(button.dataset.view)),
);
$$('[data-go]').forEach((button) =>
  button.addEventListener('click', () => switchView(button.dataset.go)),
);
$('#count-chips').addEventListener('click', (event) => {
  const button = event.target.closest('[data-count]');
  if (!button) return;
  gameCount = Number(button.dataset.count);
  todayOnly = false;
  $$('#count-chips button').forEach((item) => item.classList.toggle('selected', item === button));
});

$('#target-odds').addEventListener('input', () => {
  todayOnly = false;
});

$$('[data-preset-odds]').forEach((button) =>
  button.addEventListener('click', () => {
    gameCount = Number(button.dataset.presetGames);
    todayOnly = true;
    $('#target-odds').value = button.dataset.presetOdds;
    $$('#count-chips button').forEach((item) =>
      item.classList.toggle('selected', Number(item.dataset.count) === gameCount),
    );
    if (button.dataset.presetOdds === '2') $('#risk-mode').value = 'conservative';
    $('#build-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`${button.dataset.presetOdds} odds target ready`);
    tg?.HapticFeedback?.impactOccurred('light');
  }),
);

$('#build-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#build-error').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  const submit = event.currentTarget.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const targetValue = Number($('#target-odds').value);
    const result = await api('/api/miniapp/build', {
      sport: new FormData(event.currentTarget).get('sport'),
      gameCount,
      riskMode: $('#risk-mode').value,
      todayOnly,
      ...(Number.isFinite(targetValue) && targetValue > 1 ? { targetOdds: targetValue } : {}),
    });
    saveSlip(result);
    tg?.HapticFeedback?.notificationOccurred('success');
    switchView('slip');
    toast(
      result.targetReached
        ? `${result.selections.length} eligible picks analyzed`
        : `${result.selections.length} eligible picks · target not reached`,
    );
  } catch (error) {
    $('#build-error').textContent = error.message;
    $('#build-error').classList.remove('hidden');
    tg?.HapticFeedback?.notificationOccurred('error');
  } finally {
    $('#loading').classList.add('hidden');
    submit.disabled = false;
  }
});

$('#pick-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove]');
  if (!button || !slip) return;
  slip.selections.splice(Number(button.dataset.remove), 1);
  saveSlip(slip.selections.length ? slip : null);
  renderSlip();
  tg?.HapticFeedback?.impactOccurred('light');
});

$('#generate-code').addEventListener('click', async () => {
  const button = $('#generate-code');
  button.disabled = true;
  try {
    let result;
    try {
      result = await api('/api/miniapp/code', {
        selections: slip.selections,
        analysisToken: slip.analysisToken,
      });
    } catch (error) {
      if (error.status !== 409 || error.data?.status !== 'odds_changed') throw error;
      const accepted = window.confirm(
        `Odds changed from ${error.data.previousOdds} to ${error.data.currentOdds}. Generate at the new odds?`,
      );
      if (!accepted) return;
      result = await api('/api/miniapp/code', {
        selections: slip.selections,
        analysisToken: slip.analysisToken,
        acceptOddsChange: true,
      });
    }
    showResult(
      $('#code-result'),
      `<h3>Booking code ready</h3><p>${result.selections} selections · ${Number(result.odds).toFixed(2)} odds</p><div class="code-block"><code>${escapeHtml(result.code)}</code><button data-copy="${escapeHtml(result.code)}">Copy</button></div><p>No wager was submitted.</p>`,
    );
    tg?.HapticFeedback?.notificationOccurred('success');
  } catch (error) {
    showResult($('#code-result'), `<h3>Code not created</h3><p>${escapeHtml(error.message)}</p>`);
  } finally {
    button.disabled = false;
  }
});

$('#read-code-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/miniapp/read-code', { code: $('#read-code').value.trim() });
    showResult(
      $('#analysis-result'),
      `<h3>Code analyzed</h3><div class="code-block"><code>${escapeHtml(result.code)}</code><button data-copy="${escapeHtml(result.code)}">Copy</button></div><p>${result.selections} selections · current odds ${Number(result.combinedOdds).toFixed(2)}</p>`,
    );
  } catch (error) {
    showResult(
      $('#analysis-result'),
      `<h3>Could not read code</h3><p>${escapeHtml(error.message)}</p>`,
    );
  }
});

$('#x-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/miniapp/x-post', { url: $('#x-url').value.trim() });
    const codes = result.bookingCodes.length
      ? result.bookingCodes
          .map(
            (code) =>
              `<div class="code-block"><code>${escapeHtml(code)}</code><button data-copy="${escapeHtml(code)}">Copy</button></div>`,
          )
          .join('')
      : '<p>No code was found in the post text. Upload a screenshot if it appears in an image.</p>';
    showResult($('#analysis-result'), `<h3>X post checked</h3>${codes}`);
  } catch (error) {
    showResult(
      $('#analysis-result'),
      `<h3>Could not read post</h3><p>${escapeHtml(error.message)}</p>`,
    );
  }
});

$('#shot-file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) event.target.nextElementSibling.textContent = file.name;
});

$('#shot-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('#shot-file').files[0];
  if (!file) return;
  if (file.size > 6_000_000) {
    showResult(
      $('#analysis-result'),
      '<h3>Image is too large</h3><p>Choose a screenshot smaller than 6 MB.</p>',
    );
    return;
  }
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const result = await api('/api/miniapp/screenshot', { data, mimeType: file.type });
    const rows = result.items
      .slice(0, 10)
      .map(
        (item, index) =>
          `<p><b>${index + 1}. ${escapeHtml(item.homeTeam)} vs ${escapeHtml(item.awayTeam)}</b><br>${escapeHtml(item.selection || item.market || 'Market uncertain')} ${item.odds ? `@ ${item.odds}` : ''} · ${Math.round(item.confidence * 100)}%</p>`,
      )
      .join('');
    const codes = (result.bookingCodes || [])
      .map(
        (code) =>
          `<div class="code-block"><code>${escapeHtml(code)}</code><button data-copy="${escapeHtml(code)}">Copy</button></div>`,
      )
      .join('');
    showResult(
      $('#analysis-result'),
      `<h3>Screenshot analyzed</h3>${rows || '<p>No fixtures were confidently detected.</p>'}${codes}`,
    );
  } catch (error) {
    showResult(
      $('#analysis-result'),
      `<h3>Could not read screenshot</h3><p>${escapeHtml(error.message)}</p>`,
    );
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  await navigator.clipboard.writeText(button.dataset.copy);
  toast('Code copied');
  tg?.HapticFeedback?.impactOccurred('light');
});

renderSlip();
updateConnectionState();
