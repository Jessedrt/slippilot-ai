// News is a real, opt-in You.com Search query; every headline links to its publisher.
// Nothing in this module claims that a news article is a verified betting outcome.
const newsExplore = document.querySelector('#explore-view');
const newsTabs = newsExplore?.querySelector('.ax-explore-tabs');
const newsMake = (tag, className = '', text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const secureNewsUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};

if (newsExplore && newsTabs && !document.querySelector('#ax-news-panel')) {
  const storageKey = 'aurex-saved-news-v1';
  const readSaved = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(stored) ? stored.filter((item) => secureNewsUrl(item?.url) && typeof item.title === 'string').slice(0, 40) : [];
    } catch { return []; }
  };
  let saved = readSaved();
  const newsTab = newsMake('button', 'ax-subtab', 'News');
  newsTab.type = 'button'; newsTab.dataset.section = 'news';
  newsTab.setAttribute('role', 'tab'); newsTab.setAttribute('aria-selected', 'false');
  newsTab.setAttribute('aria-controls', 'ax-news-panel');
  newsTab.id = 'ax-news-tab'; newsTabs.append(newsTab);

  const panel = newsMake('section', 'ax-news');
  panel.id = 'ax-news-panel'; panel.hidden = true; panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'ax-news-tab');
  const header = newsMake('div', 'ax-news-head');
  const heading = newsMake('div');
  heading.append(newsMake('span', 'ax-page-kicker', 'SOURCE-LINKED SPORTS COVERAGE'),
    newsMake('h2', '', 'The latest in sports.'),
    newsMake('p', '', 'Publisher headlines from You.com Search. Open the original article for full context.'));
  const refresh = newsMake('button', 'ax-news-refresh', '↻ Refresh'); refresh.type = 'button';
  header.append(heading, refresh); panel.append(header);
  const chips = newsMake('div', 'ax-news-categories'); chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'News sport');
  const categories = [['all', 'All'], ['football', 'Football'], ['basketball', 'Basketball'],
    ['tennis', 'Tennis'], ['handball', 'Handball'], ['saved', 'Saved']];
  let active = 'all'; let articles = []; let busy = false; let fetchedAt = null;
  let lastSource = ''; let stale = false;
  const filter = newsMake('label', 'ax-search ax-news-search');
  const input = newsMake('input'); input.type = 'search'; input.maxLength = 80;
  input.placeholder = 'Search headlines and publishers';
  input.setAttribute('aria-label', 'Search loaded sports articles'); filter.append(input);
  const status = newsMake('p', 'ax-news-status', 'Choose News to load current publisher articles.');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = newsMake('div', 'ax-news-list');
  const disclaimer = newsMake('p', 'ax-news-disclaimer',
    'Headlines and publication dates come from publishers via You.com. Article availability and accuracy can change; no betting outcomes are guaranteed.');
  panel.append(chips, filter, status, list, disclaimer);
  newsTabs.after(panel);
  const showStatus = (message, error = false) => {
    status.textContent = message; status.dataset.kind = error ? 'error' : 'info';
  };
  const formatDate = (value) => {
    if (!value || Number.isNaN(Date.parse(value))) return 'Publication date unavailable';
    return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos',
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) + ' WAT';
  };
  const storeSaved = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); return true; }
    catch { return false; }
  };
  function render() {
    list.replaceChildren();
    const query = input.value.trim().toLocaleLowerCase();
    const items = (active === 'saved' ? saved : articles).filter((item) =>
      !query || `${item.title} ${item.publisher} ${item.snippet || ''}`.toLocaleLowerCase().includes(query));
    if (!items.length) {
      list.append(newsMake('p', 'ax-empty-note', active === 'saved'
        ? 'No saved articles match. Save an article from another category.'
        : articles.length ? 'No articles match your search.' : 'No current news articles were returned. Try another sport or refresh later.'));
      return;
    }
    items.forEach((article) => {
      const url = secureNewsUrl(article.url);
      if (!url) return;
      const card = newsMake('article', 'ax-news-card');
      const link = newsMake('a', 'ax-news-article'); link.href = url;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `Read original article: ${article.title}`);
      const image = newsMake('span', 'ax-news-image'); image.setAttribute('aria-hidden', 'true');
      image.append(newsMake('span', 'ax-news-star', '✦'));
      const thumbnail = secureNewsUrl(article.thumbnailUrl);
      if (thumbnail) {
        const img = newsMake('img'); img.src = thumbnail; img.alt = '';
        img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => img.remove(), { once: true }); image.append(img);
      }
      const detail = newsMake('span', 'ax-news-copy');
      detail.append(newsMake('span', 'ax-news-publisher', article.publisher),
        newsMake('strong', '', article.title),
        newsMake('small', '', article.snippet || 'Read the original publisher article.'),
        newsMake('span', 'ax-news-date', formatDate(article.publishedAt)));
      link.append(image, detail, newsMake('span', 'ax-news-arrow', '↗'));
      link.addEventListener('click', (event) => {
        const open = window.Telegram?.WebApp?.openLink;
        if (typeof open === 'function') { event.preventDefault(); open.call(window.Telegram.WebApp, url); }
      });
      const controls = newsMake('div', 'ax-news-controls');
      const bookmark = newsMake('button', 'ax-news-save'); bookmark.type = 'button';
      const syncBookmark = () => {
        const isSaved = saved.some((item) => item.url === url);
        bookmark.textContent = isSaved ? '✓ Saved' : '＋ Save article';
        bookmark.setAttribute('aria-pressed', String(isSaved));
      };
      syncBookmark();
      bookmark.addEventListener('click', () => {
        if (saved.some((item) => item.url === url)) saved = saved.filter((item) => item.url !== url);
        else saved = [{ title: article.title, url, publisher: article.publisher,
          snippet: article.snippet || '', publishedAt: article.publishedAt,
          thumbnailUrl: thumbnail }, ...saved].slice(0, 40);
        if (!storeSaved()) showStatus('Browser storage is unavailable; saved articles may not survive a reload.', true);
        syncBookmark();
        if (active === 'saved') render();
      });
      controls.append(bookmark, newsMake('span', '', 'Original publisher ↗'));
      card.append(link, controls); list.append(card);
    });
  }
  function setCategory(key) {
    active = key;
    [...chips.children].forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.sport === key)));
    input.value = '';
    if (key === 'saved') { showStatus(`${saved.length} articles saved on this device.`); render(); }
    else void load();
  }
  categories.forEach(([key, label]) => {
    const button = newsMake('button', 'ax-news-chip', label);
    button.type = 'button'; button.dataset.sport = key;
    button.setAttribute('aria-pressed', String(key === 'all'));
    button.addEventListener('click', () => setCategory(key)); chips.append(button);
  });
  async function load() {
    if (busy || active === 'saved') return;
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) {
      articles = []; fetchedAt = null;
      showStatus('Open Aurex from its Telegram bot to load real sports news. This web preview does not invent articles.', true);
      render(); return;
    }
    busy = true; refresh.disabled = true;
    showStatus(`Loading ${active === 'all' ? 'sports' : active} news from original publishers…`);
    try {
      const response = await fetch('/api/miniapp/news', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ sport: active }), signal: AbortSignal.timeout(55_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || 'News unavailable.');
      if (!Array.isArray(data.articles)) throw new Error('News provider returned an invalid response.');
      articles = data.articles.filter((item) => secureNewsUrl(item?.url) && typeof item.title === 'string');
      fetchedAt = data.fetchedAt;
      lastSource = String(data.source || 'You.com Search'); stale = Boolean(data.stale);
      showStatus(`${articles.length} source-linked articles · ${lastSource} · fetched ${formatDate(fetchedAt)}${stale ? ' · older cached coverage' : ''}.`);
      render();
    } catch (error) {
      const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'News request timed out.' : error instanceof Error ? error.message : 'News unavailable.';
      showStatus(`${message} ${articles.length ? 'Showing previously retrieved articles.' : 'No placeholder news was added.'}`, true);
      render();
    } finally { busy = false; refresh.disabled = false; }
  }
  refresh.addEventListener('click', () => { if (active === 'saved') { saved = readSaved(); render(); }
    else void load(); });
  input.addEventListener('input', render);
  newsTabs.addEventListener('click', (event) => {
    const clicked = event.target.closest('.ax-subtab');
    if (clicked && clicked !== newsTab) panel.hidden = true;
  }, { capture: true });
  newsTab.addEventListener('click', () => {
    newsTabs.querySelectorAll('.ax-subtab').forEach((tab) => {
      const selected = tab === newsTab;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    });
    newsExplore.querySelectorAll('.desk-panel, .ax-explore-promo, .ax-trending, .ax-latest, .ax-guides, .desk-shortcuts')
      .forEach((element) => { element.hidden = true; });
    panel.hidden = false;
    if (!fetchedAt) void load(); else render();
  });
}
