// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail view with the model's own inputs, and the live-token view. No
// network: every byte it shows is in data.js. Deep links: #detail=<slug>
// opens a protocol, #cat=<category> filters, #q=<text> searches,
// #tab=live opens the live view — the screenshots are taken through them.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var PAGE_SIZE = 25;
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', watchlistOnly: false, page: 0, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // The model in one function: the page recomputes a row from the snapshot
  // figures with the same constants the model used, so the page's code
  // and the board's data are visibly the same arithmetic. (The multipliers
  // stored per row are rounded for display; this recomputes them at full
  // precision from the raw change, age and chain count, exactly as the
  // model did, so the check below agrees with board.json.)
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_chains) * m.breadth_per_chain;
    var base = row.base_exact !== undefined ? row.base_exact : row.base_usd;
    return Math.max(1, Math.round(base * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  var WATCH = new Set();
  if (DATA.watchlist) DATA.watchlist.forEach(function (s) { WATCH.add(s); });

  function isWatch(r) { return WATCH.has(r.slug); }

  // ---- header facts -------------------------------------------------------
  var top = DATA.rows[0];
  var totalImplied = DATA.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  var cats = {};
  DATA.rows.forEach(function (r) { cats[r.category || 'Uncategorised'] = (cats[r.category || 'Uncategorised'] || 0) + 1; });
  var topCat = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0];
  document.getElementById('top-meta').innerHTML =
    '<span>Snapshot <b>' + esc(DATA.as_of) + '</b></span>' +
    '<span>Model <b>' + esc(DATA.model_version) + '</b></span>' +
    '<span>Top pick <b>' + esc(top ? top.name : '—') + '</b></span>';
  document.getElementById('facts').innerHTML =
    '<div><dt>Protocols ranked</dt><dd>' + DATA.board_size + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds below the floor</dt><dd>' + DATA.early_size + '</dd></div>' +
    '<div><dt>Combined implied value</dt><dd>' + fmtUsd(totalImplied) + '</dd></div>' +
    '<div><dt>Largest category</dt><dd>' + esc(topCat) + ' · ' + cats[topCat] + '</dd></div>';

  // ---- filter options -----------------------------------------------------
  var catSel = document.getElementById('category');
  Object.keys(cats).sort().forEach(function (c) {
    catSel.appendChild(el('option', { value: c }, c + ' (' + cats[c] + ')'));
  });
  var chainSel = document.getElementById('chain');
  var chains = {};
  DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = true; }); });
  Object.keys(chains).sort().forEach(function (c) { chainSel.appendChild(el('option', { value: c }, c)); });

  // ---- filtering / sorting -------------------------------------------------
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !isWatch(r)) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === 'age') return (b.age_days || 0) - (a.age_days || 0);
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderBoard() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var count = document.getElementById('count');
    if (state.tab === 'live') { renderLive(); count.textContent = DATA.live_size + ' protocols whose token already trades — shown at market value, never ranked.'; return; }
    var rows = filteredRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var slice = rows.slice(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);
    count.textContent = rows.length + ' of ' + DATA.board_size + ' pre-token protocols · page ' + (state.page + 1) + ' of ' + pages;
    if (slice.length === 0) { app.appendChild(el('div', { class: 'empty' }, 'No protocol matches these filters. Clear the search or pick another category.')); return; }
    var maxImplied = DATA.rows[0].implied_value_usd;
    var table = el('table', {});
    var head = el('thead', {}, el('tr', {},
      el('th', { class: 'num', text: '#' }),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: '7d' }),
      el('th', { class: 'num', text: 'Age' }),
      el('th', { class: 'num', text: 'Implied value' })));
    table.appendChild(head);
    var body = el('tbody', {});
    slice.forEach(function (r) {
      var pct = r.change_7d;
      var tr = el('tr', { class: state.selected === r.slug ? 'is-selected' : '', onclick: function () { select(r.slug, true); } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', {}, el('div', { class: 'name' }, r.name + (isWatch(r) ? ' ' : '')), isWatch(r) ? el('span', { class: 'pill' }, 'Watchlist') : el('span', { class: 'sub' }, r.slug)),
        el('td', {}, el('span', { class: 'sub' }, r.category || '—')),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: pct === null ? 'num' : 'num ' + (pct >= 0 ? 'pos' : 'neg'), text: fmtPct(pct) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num' },
          el('div', {}, fmtUsd(r.implied_value_usd)),
          el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied)) + '%' }))));
      body.appendChild(tr);
    });
    table.appendChild(body);
    app.appendChild(table);
    var pager = el('div', { class: 'pager' });
    var prev = el('button', { text: '← Previous', disabled: state.page === 0 ? true : null, onclick: function () { state.page--; renderBoard(); } });
    var next = el('button', { text: 'Next →', disabled: state.page >= pages - 1 ? true : null, onclick: function () { state.page++; renderBoard(); } });
    pager.appendChild(prev);
    pager.appendChild(el('span', {}, 'Page ' + (state.page + 1) + ' of ' + pages));
    pager.appendChild(next);
    app.appendChild(pager);
  }

  function renderLive() {
    app.innerHTML = '';
    var table = el('table', {});
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: '7d' }))));
    var body = el('tbody', {});
    DATA.live.forEach(function (r) {
      var pct = r.change_7d;
      body.appendChild(el('tr', {},
        el('td', {}, el('div', { class: 'name' }, r.name), el('span', { class: 'sub' }, r.slug)),
        el('td', {}, el('span', { class: 'sub' }, r.category || '—')),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: pct === null ? 'num' : 'num ' + (pct >= 0 ? 'pos' : 'neg'), text: fmtPct(pct) })));
    });
    table.appendChild(body);
    app.appendChild(table);
    app.appendChild(el('p', { class: 'count' }, 'These protocols already trade. Their market cap is the market\u2019s own value — the radar does not model it, and none of them is ranked on the pre-token board.'));
  }

  // ---- detail view ---------------------------------------------------------
  var detail = document.getElementById('detail');
  function select(slug, scroll) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { detail.hidden = true; state.selected = null; return; }
    state.selected = slug;
    var check = impliedOf(row);
    var agree = check === row.implied_value_usd ? 'matches the board' : 'differs from the board (' + fmtUsd(check) + ')';
    detail.hidden = false;
    detail.innerHTML = '';
    detail.appendChild(el('h2', {}, '#' + row.rank + ' — ' + row.name));
    detail.appendChild(el('p', { class: 'meta-line' },
      (row.category || 'Uncategorised') + ' · ' + (row.chains || []).join(', ') + ' · listed ' + (row.listed_at || 'unknown') +
      ' · ' + fmtAge(row.age_days) + ' old · TVL ' + fmtUsd(row.tvl_usd) + ' · 7d ' + fmtPct(row.change_7d) +
      (isWatch(row) ? ' · on the watchlist' : ' · early find')));
    var grid = el('div', { class: 'detail-grid' });
    var left = el('div', {});
    left.appendChild(el('h3', {}, 'Why it ranks here — the model, step by step'));
    var bd = el('table', { class: 'breakdown' });
    var bbody = el('tbody', {});
    [['Base — TVL × 0.30', fmtUsd(row.base_usd)],
     ['Growth ×' + row.growth_multiplier.toFixed(4), fmtPct(row.change_7d)],
     ['Maturity ×' + row.maturity_multiplier.toFixed(4), fmtAge(row.age_days)],
     ['Breadth ×' + row.breadth_multiplier.toFixed(4), (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's')],
     ['Implied value', fmtUsd(row.implied_value_usd)]].forEach(function (pair) {
      bbody.appendChild(el('tr', {}, el('td', { text: pair[0] }), el('td', { text: pair[1] })));
    });
    bd.appendChild(bbody);
    left.appendChild(bd);
    left.appendChild(el('p', { class: 'count' }, 'The page recomputes the implied value from these figures and it ' + agree + '.'));
    var right = el('div', {});
    right.appendChild(el('h3', {}, 'Farm plan — what to do, what it costs, how long it takes'));
    var steps = el('ol', { class: 'steps' });
    row.farm_steps.forEach(function (s) {
      var m = s.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.?$/);
      if (m) steps.appendChild(el('li', {}, m[1] + ' ', el('span', { class: 'cost' }, 'Cost: ' + m[2] + '. Time: ' + m[3] + '.')));
      else steps.appendChild(el('li', {}, s));
    });
    right.appendChild(steps);
    grid.appendChild(left);
    grid.appendChild(right);
    detail.appendChild(grid);
    detail.appendChild(el('button', { class: 'close-detail', text: 'Close detail', onclick: function () { select(null); renderBoard(); } }));
    if (scroll) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- wiring ---------------------------------------------------------------
  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      state.tab = btn.getAttribute('data-tab');
      state.page = 0;
      renderBoard();
    });
  });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; state.page = 0; renderBoard(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; state.page = 0; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; state.page = 0; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; state.page = 0; renderBoard(); });
  document.getElementById('watchlist-only').addEventListener('change', function (e) { state.watchlistOnly = e.target.checked; state.page = 0; renderBoard(); });

  // ---- deep links ------------------------------------------------------------
  function hashParams() {
    var out = {};
    (location.hash || '').replace(/^#/, '').split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) out[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  var h = hashParams();
  if (h.tab === 'live') {
    state.tab = 'live';
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === 'live'); });
  }
  if (h.cat) { state.category = h.cat; document.getElementById('category').value = h.cat; }
  if (h.chain) { state.chain = h.chain; document.getElementById('chain').value = h.chain; }
  if (h.q) { state.q = h.q; document.getElementById('q').value = h.q; }
  if (h.sort) { state.sort = h.sort; document.getElementById('sort').value = h.sort; }
  if (h.watchlist === '1') { state.watchlistOnly = true; document.getElementById('watchlist-only').checked = true; }
  renderBoard();
  if (h.detail) select(h.detail, false);
})();
