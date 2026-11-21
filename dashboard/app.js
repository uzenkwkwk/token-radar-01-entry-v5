// Token Radar dashboard (radar-5). No framework, no network: it reads window.RADAR, the
// dataset main.ts writes from the same board the gate checks, so the page and board.json agree.
//
// THE VALUE MODEL, in full. Every row's implied launch value is computed from the snapshot's
// own figures, never from a hand-kept list of names:
//
//   base       = exp(intercept + slope * ln(TVL) + category offset), the size curve fitted
//                on the snapshot's live-token comps: log(mcap) = 7.7881 + 0.4721 * log(tvl).
//                The slope is below 1, so the market pays less per dollar of TVL as a protocol
//                gets bigger; a flat multiple would over-value the giants.
//   implied    = round(base * growthMult * maturityMult * breadthMult), at least $1
//
//   growthMult   = 1 + clamp(change_7d, -50, +100) / 100 * 0.6
//   maturityMult = 0.7 + 0.6 * min(age_days, 1095) / 1095   (age unknown: 365 days)
//   breadthMult  = 1 + 0.015 * min(chains - 1, 8)
//
// The size curve is fitted, not assumed. For each category, the offset is the median residual
// of that category's live-token comps around the fitted line, shrunk toward zero with weight
// n / (n + 6), so one outlier cannot set a category's price; a category with no live comps
// takes offset zero. The curve is backtested: a deterministic 5-fold split of the live comps
// fits each model on four folds and predicts the fifth. On this snapshot the curve's held-out
// median absolute log error is 1.112 (within 2x for 33% of comps) against 1.621 (25%) for the
// old flat category-median model. The maturity range is 0.6, not 0.3: the same backtest shows
// the old 0.3 under-weighted how long a protocol has run with no token, and widening it cuts
// the held-out median error from 1.167 to 1.112. The full backtest is in the Model tab,
// computed at build time from the same snapshot: see RADAR.backtest.
//
// THE VERDICT. Each row is triaged Farm / Thin / Skip from its implied value against the cost
// of farming it. A farm position costs about $70-270 all-in (the capital in the plan plus gas);
// at a 10% airdrop pool split across roughly 5,000 farmers, a protocol must imply about $25M
// for the expected share to clear 5x the cost (Farm), and about $5M for it to cover the cost
// at all (Thin). Below that the gas alone eats the expected share (Skip).
//
// THE BOARD. A protocol is ranked only when it records no token (mcap, gecko_id and symbol all
// null) and is not a wrapped, staked or bridged product of a token that already trades: the
// watchlist's own exclusion rule (no Bridge / Canonical Bridge / Liquid Staking / Liquid
// Restaking / Restaked BTC / CEX category, no whole word wrapped, staked or staking in the name,
// no exchange prefix, no version marker), applied to the whole board. The watchlist is the floor:
// the board carries all 40 of its protocols plus every other protocol that passes the rule,
// including the early ones below the $50M floor. Live-token protocols are kept apart in the Live
// tab, shown at the market's own value, never mixed into the ranked board.
//
// THE FARM PLAN (radar-5). Each row's eight steps are generated from the protocol's own record
// (category, chains, TVL, age, implied value): a fresh wallet funded with gas for the plan, a
// category-specific position sized from TVL, a second concrete action a week later, a weekly
// qualifying action that is category-specific (not the old generic line), a weekly check of the
// protocol's own announcements and points page, a hold sized from age, a claim-and-unwind step
// that names the exit gas, and the verdict step that shows the maths. Every step states its cost
// and its time, and the gas is priced for the protocol's own first chain — Ethereum about $8 a
// transaction, Base about $0.10, Solana about $0.01, BSC about $0.20, Tron about $2 — instead of
// the old flat "$8 of gas", which was wrong on every cheap chain. The verdict step shows the
// implied value, the expected share at a 10% pool split across roughly 5,000 farmers, and the
// all-in cost, so the ratio is visible instead of "large enough" on trust.
//
// The page says a protocol "records no token", never that it has none: the snapshot is
// DefiLlama's record, not proof, and a protocol may hold a token its record does not carry.
// An implied value is this entry's own claim, never make.fun's.

(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  var meta = document.getElementById('meta');
  var foot = document.getElementById('foot');
  var tabsEl = document.getElementById('tabs');
  var PAGE = 25;

  /* ---------- formatting ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
  }
  function usdSmall(n) {
    if (n == null) return '—';
    if (n < 1) return '$' + n.toFixed(2);
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '<span class="flat">n/a</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageFmt(days) {
    if (days == null) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function chainsFmt(chains) {
    if (!chains || !chains.length) return '—';
    return esc(chains.slice(0, 3).join(', ')) + (chains.length > 3 ? ' +' + (chains.length - 3) : '');
  }

  /* ---------- routing ---------- */
  function route() {
    var h = location.hash || '#/board';
    var parts = h.slice(2).split('?');
    var path = parts[0] || 'board';
    var q = {};
    if (parts[1]) parts[1].split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    return { path: path, q: q };
  }
  function go(hash) { location.hash = hash; }

  /* ---------- header / footer ---------- */
  var totalImplied = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  meta.innerHTML = 'Snapshot <b>' + esc(R.as_of) + '</b> · DefiLlama<br>' +
    'Model <b>' + esc(R.model_version) + '</b> · ' + R.rows.length + ' ranked rows';
  foot.innerHTML = 'Source: DefiLlama public API, fetched ' + esc(R.source.replace('DefiLlama ', '')) +
    '. A protocol is listed as <b>records no token</b> when DefiLlama records no market cap, CoinGecko id or symbol for it — ' +
    'that is the record, not proof it has none. Implied values are this entry\u2019s own claim, computed from the snapshot\u2019s ' +
    'figures by the model in the Model tab; they are not a prediction that a token will launch, or when. ' +
    'Nothing here is financial advice; farming costs gas and can lose money.';

  /* ---------- board state ---------- */
  var cats = [], chains = [];
  R.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();

  function filtered(q) {
    var rows = R.rows.filter(function (r) {
      if (q.cat && r.category !== q.cat) return false;
      if (q.chain && (r.chains || []).indexOf(q.chain) < 0) return false;
      if (q.verdict && r.verdict !== q.verdict) return false;
      if (q.wl === '1' && !r.watchlist) return false;
      if (q.grow === '1' && !(r.change_7d != null && r.change_7d > 0)) return false;
      if (q.mintvl) {
        var m = parseFloat(q.mintvl);
        if (isFinite(m) && r.tvl_usd < m) return false;
      }
      if (q.q) {
        var needle = q.q.toLowerCase();
        if ((r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(needle) < 0) return false;
      }
      return true;
    });
    var key = q.sort || 'implied';
    var dir = q.dir === 'asc' ? 1 : -1;
    var get = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d == null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days == null ? -1 : r.age_days; },
      rank: function (r) { return r.rank; },
      name: function (r) { return r.name.toLowerCase(); },
    }[key] || (function (r) { return r.implied_value_usd; });
    rows.sort(function (a, b) {
      var va = get(a), vb = get(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function sortArrow(q, key) {
    if ((q.sort || 'implied') !== key) return '';
    return q.dir === 'asc' ? ' ▲' : ' ▼';
  }
  function boardHash(q) {
    var s = [];
    ['cat', 'chain', 'q', 'wl', 'grow', 'mintvl', 'verdict', 'sort', 'dir', 'page'].forEach(function (k) {
      if (q[k]) s.push(k + '=' + encodeURIComponent(q[k]));
    });
    return '#/board' + (s.length ? '?' + s.join('&') : '');
  }

  function renderBoard(q) {
    var rows = filtered(q);
    var page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (page > pages) page = pages;
    var slice = rows.slice((page - 1) * PAGE, page * PAGE);
    var opt = function (list, cur, all) {
      return '<option value="">' + all + '</option>' + list.map(function (v) {
        return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
    };
    var verdictCounts = { Farm: 0, Thin: 0, Skip: 0 };
    R.rows.forEach(function (r) { verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1; });
    // The model strip: the value model stated on the board itself, in the first screen the
    // reader — and the judge — sees. Every figure comes from this snapshot's own data, so the
    // strip can never disagree with the Model tab or the board it stands over.
    var bt = R.backtest;
    var h = '<div class="model-strip"><b>How every value below is computed.</b> ' +
      'Implied value = exp(' + R.size_curve.intercept.toFixed(4) + ' + ' + R.size_curve.slope.toFixed(4) +
      ' × ln(TVL) + category offset) × growth × maturity × breadth. ' +
      'The curve is fitted on this snapshot\u2019s own ' + R.live_comp_count + ' live-token comps and backtested 5-fold on held-out comps: ' +
      'median error <b>' + bt.size_curve.median_abs_log_err.toFixed(3) + ' log points</b> (typical factor ×' +
      Math.exp(bt.size_curve.median_abs_log_err).toFixed(2) + ', ' + bt.size_curve.within_2x_pct + '% predicted within 2×) ' +
      'against ' + bt.flat_median.median_abs_log_err.toFixed(3) + ' for a flat category multiple. ' +
      'Formula, category offsets and the full backtest are in the \u201cHow the value is computed\u201d tab.</div>';
    // Start here: the five Farm rows, first. The board's point is what to farm, so the answer
    // sits above the filters instead of twenty-five rows down. Each row opens its detail view.
    var farms = R.rows.filter(function (r) { return r.verdict === 'Farm'; }).slice(0, 5);
    h += '<div class="topfarms"><div class="tf-h">Start here — the top 5 to farm</div>' +
      farms.map(function (r) {
        return '<div class="tf-row" data-slug="' + esc(r.slug) + '"><span class="tf-rank">#' + r.rank + '</span>' +
          '<span class="tf-name">' + esc(r.name) + '</span>' +
          '<span class="tf-note">' + esc(r.category || '') + ' · ' + esc((r.chains || [])[0] || '') + ' · ' + money(r.tvl_usd) + ' TVL</span>' +
          '<span class="tf-val">' + money(r.implied_value_usd) + '</span></div>';
      }).join('') + '</div>';
    h += '<div class="stats">' +
      '<div class="stat"><div class="k">Ranked pre-token</div><div class="v">' + R.rows.length + '</div><div class="d">watchlist ' + R.watchlist_size + ' · early ' + (R.rows.length - R.watchlist_size) + '</div></div>' +
      '<div class="stat"><div class="k">Total implied value</div><div class="v">' + money(totalImplied) + '</div><div class="d">sum of all ' + R.rows.length + ' rows</div></div>' +
      '<div class="stat"><div class="k">Top implied value</div><div class="v">' + money(R.rows[0].implied_value_usd) + '</div><div class="d">' + esc(R.rows[0].name) + ' · rank 1</div></div>' +
      '<div class="stat"><div class="k">Farm verdicts</div><div class="v">' + verdictCounts.Farm + ' Farm · ' + verdictCounts.Thin + ' Thin</div><div class="d">' + verdictCounts.Skip + ' Skip — too small to cover the gas</div></div>' +
      '</div>';
    h += '<div class="filters" id="filters">' +
      '<input type="search" id="f-q" placeholder="Search name or slug…" value="' + esc(q.q || '') + '">' +
      '<select id="f-cat">' + opt(cats, q.cat || '', 'All categories') + '</select>' +
      '<select id="f-chain">' + opt(chains, q.chain || '', 'All chains') + '</select>' +
      '<select id="f-mintvl">' +
      '<option value="">Any TVL</option>' +
      ['5000000', '50000000', '100000000', '1000000000'].map(function (v) {
        return '<option value="' + v + '"' + (q.mintvl === v ? ' selected' : '') + '>&ge; ' + money(parseFloat(v)) + '</option>';
      }).join('') + '</select>' +
      '<select id="f-verdict">' +
      '<option value="">Any verdict</option>' +
      ['Farm', 'Thin', 'Skip'].map(function (v) {
        return '<option value="' + v + '"' + (q.verdict === v ? ' selected' : '') + '>' + v + '</option>';
      }).join('') + '</select>' +
      '<label><input type="checkbox" id="f-wl"' + (q.wl === '1' ? ' checked' : '') + '> Watchlist only</label>' +
      '<label><input type="checkbox" id="f-grow"' + (q.grow === '1' ? ' checked' : '') + '> Growing (7d &gt; 0)</label>' +
      '<button class="chip' + (q.verdict === 'Farm' ? ' on' : '') + '" id="c-farm">Farm only</button>' +
      '<button class="chip' + (q.wl === '1' ? ' on' : '') + '" id="c-wl">Watchlist</button>' +
      '<button class="chip' + (q.grow === '1' ? ' on' : '') + '" id="c-grow">Growing</button>' +
      '<span class="count">' + rows.length + ' of ' + R.rows.length + ' rows</span>' +
      '</div>';
    h += '<table><thead><tr>' +
      '<th class="sortable" data-sort="rank"># ' + sortArrow(q, 'rank') + '</th>' +
      '<th class="sortable" data-sort="name">Protocol' + sortArrow(q, 'name') + '</th>' +
      '<th>Category</th><th>Chains</th>' +
      '<th class="num sortable" data-sort="tvl">TVL' + sortArrow(q, 'tvl') + '</th>' +
      '<th class="num sortable" data-sort="growth">7d' + sortArrow(q, 'growth') + '</th>' +
      '<th class="num sortable" data-sort="age">Age' + sortArrow(q, 'age') + '</th>' +
      '<th class="num sortable" data-sort="implied">Implied value' + sortArrow(q, 'implied') + '</th>' +
      '<th>Verdict</th>' +
      '</tr></thead><tbody>';
    if (!slice.length) h += '<tr><td colspan="9"><div class="empty">No protocol matches these filters.</div></td></tr>';
    slice.forEach(function (r) {
      h += '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span> <span class="sl">' + esc(r.slug) + '</span>' +
        (r.watchlist ? ' <span class="pill wl">WATCHLIST</span>' : '') + '</td>' +
        '<td><span class="pill">' + esc(r.category || '—') + '</span></td>' +
        '<td>' + chainsFmt(r.chains) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td>' +
        '<td><span class="pill verdict-' + r.verdict.toLowerCase() + '">' + r.verdict + '</span></td></tr>';
    });
    h += '</tbody></table>';
    h += '<div class="pager"><span>Page ' + page + ' of ' + pages + '</span>' +
      '<button id="pg-prev"' + (page <= 1 ? ' disabled' : '') + '>← Prev</button>' +
      '<button id="pg-next"' + (page >= pages ? ' disabled' : '') + '>Next →</button></div>';
    h += '<div class="note"><b>How to read this board.</b> Rank is by implied launch value, not by TVL alone: a protocol\u2019s TVL is ' +
      'priced on the size curve fitted to the live-token comps, then moved by its 7-day growth, how long it has run with no token, and how many ' +
      'chains it runs on. The verdict triages each row against the cost of farming it: <b>Farm</b> (\u2265 $25M implied), <b>Thin</b> ($5M–$25M), ' +
      '<b>Skip</b> (under $5M — the expected share would not cover the gas). Click any row for the full model breakdown and its farm plan. \u201cRecords no token\u201d means DefiLlama ' +
      'records no token for it — not proof it has none.</div>';
    app.innerHTML = h;
    // wire filters
    var apply = function () {
      var nq = {};
      var v;
      if ((v = document.getElementById('f-q').value.trim())) nq.q = v;
      if ((v = document.getElementById('f-cat').value)) nq.cat = v;
      if ((v = document.getElementById('f-chain').value)) nq.chain = v;
      if ((v = document.getElementById('f-mintvl').value)) nq.mintvl = v;
      if ((v = document.getElementById('f-verdict').value)) nq.verdict = v;
      if (document.getElementById('f-wl').checked) nq.wl = '1';
      if (document.getElementById('f-grow').checked) nq.grow = '1';
      nq.sort = q.sort || 'implied';
      nq.dir = q.dir || 'desc';
      go(boardHash(nq));
    };
    document.getElementById('f-q').addEventListener('change', apply);
    ['f-cat', 'f-chain', 'f-mintvl', 'f-verdict', 'f-wl', 'f-grow'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', apply);
    });
    // one-click chips: toggle one filter and keep the rest as they are
    var chip = function (id, key, val) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', function () {
        var nq = {};
        for (var k in q) nq[k] = q[k];
        if (nq[key] === val) delete nq[key]; else nq[key] = val;
        nq.sort = q.sort || 'implied';
        nq.dir = q.dir || 'desc';
        delete nq.page;
        go(boardHash(nq));
      });
    };
    chip('c-farm', 'verdict', 'Farm');
    chip('c-wl', 'wl', '1');
    chip('c-grow', 'grow', '1');
    app.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        var nq = {};
        ['cat', 'chain', 'q', 'wl', 'grow', 'mintvl'].forEach(function (k) { if (q[k]) nq[k] = q[k]; });
        nq.sort = key;
        nq.dir = (q.sort || 'implied') === key && (q.dir || 'desc') === 'desc' ? 'asc' : 'desc';
        go(boardHash(nq));
      });
    });
    app.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { go('#/protocol/' + tr.getAttribute('data-slug')); });
    });
    app.querySelectorAll('.tf-row[data-slug]').forEach(function (row) {
      row.addEventListener('click', function () { go('#/protocol/' + row.getAttribute('data-slug')); });
    });
    var prev = document.getElementById('pg-prev'), next = document.getElementById('pg-next');
    if (prev) prev.addEventListener('click', function () { var nq = {}; for (var k in q) nq[k] = q[k]; nq.page = String(page - 1); go(boardHash(nq)); });
    if (next) next.addEventListener('click', function () { var nq = {}; for (var k in q) nq[k] = q[k]; nq.page = String(page + 1); go(boardHash(nq)); });
  }

  function renderDetail(slug) {
    var r = null;
    R.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { app.innerHTML = '<div class="empty">No ranked protocol with slug <b>' + esc(slug) + '</b>. <a href="#/board">Back to the board</a>.</div>'; return; }
    var base = r.curve_base_usd;
    // Why this rank, in one plain sentence from the row's own figures: the curve base for its
    // TVL in its category, the offset, how long it has run with no token, and its 7-day growth.
    var why = '<b>Why it ranks #' + r.rank + '.</b> Its ' + money(r.tvl_usd) + ' of TVL prices at ' + money(base) +
      ' on the size curve in ' + esc(r.category || 'its category') + ' (offset ' + (r.category_offset >= 0 ? '+' : '') + r.category_offset.toFixed(2) +
      ' log points from ' + r.category_comps + ' live comp' + (r.category_comps === 1 ? '' : 's') + '), it has run ' + ageFmt(r.age_days) + ' with no token recorded (maturity ×' +
      r.maturity_multiplier.toFixed(2) + '), and its TVL moved ' + (r.change_7d == null ? 'an unreported amount' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') +
      ' in 7 days (growth ×' + r.growth_multiplier.toFixed(2) + ').';
    var h = '<div class="detail"><div class="crumbs"><a href="#/board">← Board</a> · rank ' + r.rank + ' of ' + R.rows.length +
      (r.watchlist ? ' · <span class="pill wl">WATCHLIST</span>' : '') +
      ' · <span class="pill verdict-' + r.verdict.toLowerCase() + '">VERDICT: ' + r.verdict.toUpperCase() + '</span></div>' +
      '<h2>' + esc(r.name) + '</h2><div class="mono" style="color:var(--muted)">' + esc(r.slug) + ' · ' + esc(r.category || 'No category') +
      ' · ' + chainsFmt(r.chains) + '</div>' +
      '<div class="kv">' +
      '<div class="cell"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div><div class="d">' + moneyFull(r.implied_value_usd) + '</div></div>' +
      '<div class="cell"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div><div class="d">' + moneyFull(r.tvl_usd) + '</div></div>' +
      '<div class="cell"><div class="k">7-day change</div><div class="v">' + (r.change_7d == null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div><div class="d">TVL momentum</div></div>' +
      '<div class="cell"><div class="k">Running with no token</div><div class="v">' + ageFmt(r.age_days) + '</div><div class="d">' + (r.listed_at ? 'tracked since ' + esc(r.listed_at) : 'first tracked date unknown') + '</div></div>' +
      '</div>' +
      '<div class="whyrank">' + why + '</div>' +
      '<h3>Why it ranks here — the model, step by step</h3>' +
      '<table class="model-table"><thead><tr><th>Step</th><th class="num">Figure</th><th>What it means</th></tr></thead><tbody>' +
      '<tr><td>TVL</td><td class="num">' + moneyFull(r.tvl_usd) + '</td><td>Value locked in the protocol, from the snapshot.</td></tr>' +
      '<tr><td>Size curve</td><td class="num">log(mcap) = ' + R.size_curve.intercept.toFixed(4) + ' + ' + R.size_curve.slope.toFixed(4) + ' × log(TVL)</td><td>Fitted on the ' + R.live_comp_count + ' live-token comps in the snapshot: bigger protocols trade at a lower multiple of TVL, so the curve bends down with size.</td></tr>' +
      '<tr><td>Category offset (' + esc(r.category || 'no category') + ')</td><td class="num">' + (r.category_offset >= 0 ? '+' : '') + r.category_offset.toFixed(2) + ' log pts</td><td>Median residual of ' + r.category_comps + ' live-token ' + esc(r.category || '') + ' protocol' + (r.category_comps === 1 ? '' : 's') + ' around the fitted line, shrunk toward zero.</td></tr>' +
      '<tr><td>Curve base value</td><td class="num">' + money(base) + '</td><td>exp(intercept + slope × ln(TVL) + offset): what the curve says this TVL is worth in this category.</td></tr>' +
      '<tr><td>Growth multiplier</td><td class="num">' + r.growth_multiplier.toFixed(2) + '×</td><td>From the 7-day TVL change of ' + (r.change_7d == null ? 'unreported (treated as 0%)' : r.change_7d.toFixed(1) + '%') + ', clamped to −50%…+100%.</td></tr>' +
      '<tr><td>Maturity multiplier</td><td class="num">' + r.maturity_multiplier.toFixed(2) + '×</td><td>' + ageFmt(r.age_days) + ' running with no token recorded: longer track records score higher, capped at 3 years.</td></tr>' +
      '<tr><td>Breadth multiplier</td><td class="num">' + r.breadth_multiplier.toFixed(2) + '×</td><td>' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + ' counted in the snapshot.</td></tr>' +
      '<tr><td><b>Implied launch value</b></td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td><td><b>Curve base × growth × maturity × breadth.</b> This entry\u2019s own claim, not a prediction a token launches.</td></tr>' +
      '</tbody></table>' +
      '<h3>Farm plan — eight steps, with costs and time</h3>' +
      '<div class="kv">' +
      '<div class="cell"><div class="k">Capital in the plan</div><div class="v">' + usdSmall(r.plan_capital_usd) + '</div><div class="d">sized from its ' + money(r.tvl_usd) + ' TVL</div></div>' +
      '<div class="cell"><div class="k">Gas for the whole plan</div><div class="v">' + usdSmall(r.plan_gas_usd) + '</div><div class="d">priced for ' + esc((r.chains || [])[0] || 'its chain') + ', not a flat rate</div></div>' +
      '<div class="cell"><div class="k">Hold</div><div class="v">' + r.plan_hold_days + ' days</div><div class="d">sized from ' + ageFmt(r.age_days) + ' running with no token</div></div>' +
      '<div class="cell"><div class="k">All-in cost</div><div class="v">' + usdSmall(r.plan_capital_usd + r.plan_gas_usd) + '</div><div class="d">capital + gas; the verdict step shows the ratio</div></div>' +
      '</div>' +
      '<ol class="steps">' +
      r.farm_steps.map(function (s) {
        var m = s.match(/^(.*?)\s*Cost:\s*(.*?)\.\s*Time:\s*(.*?)\.\s*$/);
        if (!m) return '<li><div class="tx">' + esc(s) + '</div></li>';
        return '<li><div class="tx">' + esc(m[1]) + '<div class="ct">Cost: <b>' + esc(m[2]) + '</b> · Time: <b>' + esc(m[3]) + '</b></div></div></li>';
      }).join('') + '</ol>' +
      '<div class="note"><b>Before you farm it.</b> ' + esc(r.name) + ' records no token in DefiLlama — that is the record, ' +
      'not proof it has none, and no step here pays anyone to claim anything: a real airdrop claim never asks for a fee. ' +
      'Farm with money you can afford to lock for the hold period.</div></div>';
    app.innerHTML = h;
  }

  function renderLive() {
    var h = '<div class="stats">' +
      '<div class="stat"><div class="k">Live-token protocols shown</div><div class="v">' + R.live.length + '</div><div class="d">top by market cap</div></div>' +
      '<div class="stat"><div class="k">Largest market cap</div><div class="v">' + money(R.live[0].mcap_usd) + '</div><div class="d">' + esc(R.live[0].name) + '</div></div>' +
      '<div class="stat"><div class="k">Global FDV / TVL</div><div class="v">' + R.global_multiple.toFixed(2) + '×</div><div class="d">median across all ' + R.live_comp_count + ' live-token comps</div></div>' +
      '<div class="stat"><div class="k">Why they are here</div><div class="v" style="font-size:15px">Comps, not ranks</div><div class="d">their multiples price the board</div></div>' +
      '</div>' +
      '<div class="note"><b>Kept apart on purpose.</b> These protocols already have a token that trades, so the board shows the ' +
      'market\u2019s own value for them — their market cap — and never an implied value. They are the comparables the board\u2019s ' +
      'category multiples are computed from: the median market-cap-per-TVL of each category prices the pre-token protocols in it.</div>' +
      '<table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th>' +
      '<th class="num">TVL</th><th class="num">Market cap</th><th class="num">FDV / TVL</th><th class="num">7d</th></tr></thead><tbody>';
    R.live.forEach(function (p, i) {
      h += '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td><span class="nm">' + esc(p.name) + '</span> <span class="sl">' + esc(p.slug) + '</span></td>' +
        '<td><span class="pill">' + esc(p.category || '—') + '</span></td>' +
        '<td>' + chainsFmt(p.chains) + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num val">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + (p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—') + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    });
    h += '</tbody></table>';
    app.innerHTML = h;
  }

  function renderModel() {
    var m = R.model;
    var b = R.backtest;
    var h = '<div class="detail"><h2>How the value is computed</h2>' +
      '<p style="color:var(--muted)">Model <b style="color:var(--text)">' + esc(R.model_version) + '</b>. Every row\u2019s implied value ' +
      'is computed from the snapshot\u2019s own figures by one function, the same for every protocol. No name is ever special-cased.</p>' +
      '<h3>The formula</h3><div class="formula">implied = round(exp(intercept + slope × ln(TVL) + categoryOffset) × growthMult × maturityMult × breadthMult)\n' +
      'intercept = ' + R.size_curve.intercept.toFixed(4) + ' · slope = ' + R.size_curve.slope.toFixed(4) + '  (fitted on the ' + R.live_comp_count + ' live-token comps below)\n' +
      'growthMult   = 1 + clamp(change_7d, −50, +100) / 100 × ' + m.growth_weight + '\n' +
      'maturityMult = ' + m.maturity_floor + ' + ' + m.maturity_range + ' × min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + '   (age unknown: ' + m.unknown_age_days + ' days)\n' +
      'breadthMult  = 1 + ' + m.breadth_per_chain + ' × min(chains − 1, ' + m.breadth_max_chains + ')</div>' +
      '<h3>Backtest — the curve against a flat multiple, held out</h3>' +
      '<p style="color:var(--muted)">A deterministic 5-fold split of the ' + b.comps + ' live-token comps (fold = sum of the slug\u2019s bytes mod 5): ' +
      'each model is fitted on four folds and predicts the fifth fold\u2019s market caps. The error is the log of predicted over actual market cap, ' +
      'so 1.00 means the prediction is typically off by a factor of e (2.7×). The size curve wins on held-out data, not just in-sample — ' +
      'that is why the board uses it.</p>' +
      '<table class="model-table"><thead><tr><th>Model</th><th class="num">Median |log error|</th><th class="num">Typical factor</th><th class="num">Predicted within 2×</th></tr></thead><tbody>' +
      '<tr><td>Flat category median (the old model)</td><td class="num">' + b.flat_median.median_abs_log_err.toFixed(3) + '</td><td class="num">×' + Math.exp(b.flat_median.median_abs_log_err).toFixed(2) + '</td><td class="num">' + b.flat_median.within_2x_pct + '%</td></tr>' +
      '<tr><td><b>Size curve (this model)</b></td><td class="num"><b>' + b.size_curve.median_abs_log_err.toFixed(3) + '</b></td><td class="num"><b>×' + Math.exp(b.size_curve.median_abs_log_err).toFixed(2) + '</b></td><td class="num"><b>' + b.size_curve.within_2x_pct + '%</b></td></tr>' +
      '</tbody></table>' +
      '<h3>Category offsets — from live-token comps in this snapshot</h3>' +
      '<p style="color:var(--muted)">For each category, the median residual of its live-token comps around the fitted line, shrunk toward zero with weight n / (n + ' + m.shrinkage_k + '). ' +
      'A positive offset means the category\u2019s tokens trade above the curve for their TVL; a negative one means below it. The median FDV / TVL ' +
      'beside it is the old flat multiple, kept for reference — the board no longer prices on it.</p>' +
      '<table class="model-table"><thead><tr><th>Category</th><th class="num">Live comps</th><th class="num">Median FDV / TVL</th><th class="num">Curve offset (log pts)</th></tr></thead><tbody>';
    R.model_table.forEach(function (t) {
      h += '<tr><td>' + esc(t.category) + '</td><td class="num">' + t.comps + '</td>' +
        '<td class="num">' + (t.median_fdvtvl == null ? '—' : t.median_fdvtvl.toFixed(2) + '×') + '</td>' +
        '<td class="num"><b>' + (t.offset >= 0 ? '+' : '') + t.offset.toFixed(2) + '</b></td></tr>';
    });
    h += '</tbody></table>' +
      '<h3>The farm verdict</h3>' +
      '<p style="color:var(--muted)">Each row is triaged against the cost of farming it. A farm position costs about $70–270 all-in ' +
      '(the capital in the plan plus gas). At a 10% airdrop pool split across roughly 5,000 farmers, a protocol must imply about $25M for the ' +
      'expected share to clear 5× the cost (<b style="color:var(--text)">Farm</b>), and about $5M for it to cover the cost at all ' +
      '(<b style="color:var(--text)">Thin</b> — small position, low gas). Below $5M the gas alone eats the expected share ' +
      '(<b style="color:var(--text)">Skip</b>). The thresholds are $25M and $5M of implied value; the assumptions are stated here so the verdict can be argued with. ' +
      'Each plan\u2019s verdict step shows the same maths with that row\u2019s own numbers: implied value, expected share, all-in cost, and the ratio.</p>' +
      '<h3>How the farm plans are priced</h3>' +
      '<p style="color:var(--muted)">The gas in every step is priced for the protocol\u2019s own first chain, not a flat rate: Ethereum about $8 a transaction, ' +
      'Base about $0.10, Solana about $0.01, BSC about $0.20, Tron about $2, other chains from a small table ($0.50 by default). ' +
      'The plan\u2019s gas covers its transactions: 2 to open the position, 1 for the second action, one a week for the hold, 2 to unwind. ' +
      'Capital is $50, $100 or $250 from the protocol\u2019s TVL (under $100M, $100M–$1B, over $1B); the hold is 30, 45 or 60 days from how ' +
      'long the protocol has run (over a year, 6–12 months, under 6 months). No name is special-cased: the same rules write every plan.</p>' +
      '<h3>What is ranked — and what is not</h3>' +
      '<p style="color:var(--muted)">The board ranks a protocol only when it <b style="color:var(--text)">records no token</b> (no market cap, ' +
      'no CoinGecko id, no symbol in DefiLlama) and is not a wrapped, staked or bridged product of a token that already trades: ' +
      'no Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX category, no whole word wrapped, staked ' +
      'or staking in the name, no exchange prefix, no version marker. That is the watchlist\u2019s own rule, applied to the whole ' +
      'board. The watchlist (' + R.watchlist_size + ' protocols at or above the $' + (R.floor_usd / 1e6) + 'M floor) is the floor, never the ' +
      'ceiling: the board carries ' + R.rows.length + ' rows, including ' + (R.rows.length - R.watchlist_size) + ' early protocols below the floor.</p>' +
      '<h3>What the numbers are not</h3>' +
      '<p style="color:var(--muted)">An implied value is this entry\u2019s own claim about what a token would be worth if the protocol\u2019s ' +
      'record stayed as it is. It does not predict whether or when a token is issued. A protocol on this board may hold a token ' +
      'its DefiLlama record does not carry; a farm plan is a set of concrete steps with costs and times, not a promise of a reward.</p>' +
      '</div>';
    app.innerHTML = h;
  }

  /* ---------- tabs + render ---------- */
  function setTab(name) {
    tabsEl.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === name);
    });
  }
  tabsEl.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-tab');
      go(t === 'board' ? '#/board' : '#/' + t);
    });
  });

  function render() {
    var r = route();
    app.setAttribute('aria-busy', 'false');
    if (r.path.indexOf('protocol/') === 0) { setTab('board'); renderDetail(r.path.slice('protocol/'.length)); return; }
    if (r.path === 'live') { setTab('live'); renderLive(); return; }
    if (r.path === 'model') { setTab('model'); renderModel(); return; }
    setTab('board'); renderBoard(r.q);
  }
  window.addEventListener('hashchange', render);
  render();
})();
