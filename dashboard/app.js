'use strict';
/* Token Radar dashboard, model radar-2.
 *
 * The page renders from window.RADAR (data.js, written by main.ts from the sealed snapshot).
 * It carries its own copy of the farm-plan logic and the scoring model, so the detail view and
 * the sandbox recompute from the same inputs board.json was built from. Nothing here calls the
 * network.
 */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clampTo(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function moneyShort(v) {
  const a = Math.abs(v);
  if (a >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}
function valueFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
function changeSigned(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return sign + Math.abs(v).toFixed(2) + '%';
}
function ageShort(age) {
  if (age === null || age === undefined) return '—';
  if (age < 30) return age + 'd';
  if (age < 365) return (age / 30.44).toFixed(1) + 'mo';
  return (age / 365.25).toFixed(1) + 'y';
}
function multShort(v) { return v.toFixed(3); }

/* ------------------------------------------------------------------ farm plan
 * The same plan lib/model.ts writes into board.json, so the page and the board agree. */
function depositSize(tvl) {
  if (tvl >= 5000000000) return '$250';
  if (tvl >= 1000000000) return '$150';
  if (tvl >= 100000000) return '$100';
  return '$50';
}
function holdFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
const CATEGORY_ACTIONS = [
  {
    kinds: ['Lending', 'CDP', 'CDP Manager', 'Collateral Markets', 'Collateral Management'],
    act: (n, cap) => 'Put ' + cap + ' into a ' + n + ' lending market and leave the position open',
    weekly: 'add a small deposit or borrow a little against the collateral',
  },
  {
    kinds: ['Dexs', 'Derivatives', 'Perps', 'Options', 'Basis Trading'],
    act: (n, cap) => 'Swap ' + cap + ' through a ' + n + ' pool and put the same amount in as liquidity',
    weekly: 'make one swap or add a little liquidity',
  },
  {
    kinds: ['Yield', 'Yield Aggregator', 'Liquidity Manager'],
    act: (n, cap) => 'Put ' + cap + ' into a ' + n + ' yield vault and hold on to the receipt tokens',
    weekly: 'compound the yield or add a small deposit',
  },
  {
    kinds: ['Risk Curators', 'Onchain Capital Allocator', 'Onchain Capital Allocators'],
    act: (n, cap) => 'Put ' + cap + ' into a ' + n + ' vault on its biggest chain and keep the shares',
    weekly: 'check the vault allocation and rebalance if it has changed',
  },
  {
    kinds: ['RWA'],
    act: (n, cap) => 'Buy ' + cap + ' of ' + n + '\u2019s tokenised real-world asset offering and hold it',
    weekly: 'check the asset\u2019s yield accrual and keep the position',
  },
  {
    kinds: ['Prediction Market'],
    act: (n, cap) => 'Take a ' + cap + ' position on a ' + n + ' market and let it settle',
    weekly: 'take one small position on a new market',
  },
  {
    kinds: ['Chain'],
    act: (n, cap) => 'Bridge ' + cap + ' onto the ' + n + ' chain and use its native apps',
    weekly: 'make one transaction on the chain',
  },
  {
    kinds: ['Staking Pool', 'Restaking', 'Liquid Restaking'],
    act: (n, cap) => 'Stake ' + cap + ' through ' + n + ' and leave the position staked',
    weekly: 'check the staking rewards and keep the stake in place',
  },
  {
    kinds: ['Launchpad', 'Token Locker'],
    act: (n, cap) => 'Join one ' + n + ' launch or lock ' + cap + ' of tokens in its locker',
    weekly: 'check for a new launch and join one if it fits',
  },
  {
    kinds: ['Indexes'],
    act: (n, cap) => 'Buy ' + cap + ' of a ' + n + ' index and hold it',
    weekly: 'check the index makeup and keep the position',
  },
  {
    kinds: ['Payments'],
    act: (n, cap) => 'Pay ' + cap + ' through ' + n + ' to a real counterparty and keep the receipt',
    weekly: 'make one real payment through the protocol',
  },
  {
    kinds: ['Privacy'],
    act: (n, cap) => 'Route ' + cap + ' through ' + n + '\u2019s private flow and keep the receipt',
    weekly: 'make one private transfer through the protocol',
  },
  {
    kinds: ['NFT Marketplace'],
    act: (n, cap) => 'List or buy one item on ' + n + ' for about ' + cap,
    weekly: 'make one trade on the marketplace',
  },
  {
    kinds: ['Insurance'],
    act: (n, cap) => 'Buy ' + cap + ' of cover on ' + n + ' for a position you already hold',
    weekly: 'check the cover terms and keep the policy active',
  },
  {
    kinds: ['Dual-Token Stablecoin'],
    act: (n, cap) => 'Mint ' + cap + ' of ' + n + '\u2019s stablecoin against collateral and hold it',
    weekly: 'check the collateral ratio and top it up if it slips',
  },
  {
    kinds: ['Leveraged Farming', 'DOR'],
    act: (n, cap) => 'Open a ' + cap + ' leveraged position on ' + n + ' and keep it collateralised',
    weekly: 'check the position health and add collateral if needed',
  },
  {
    kinds: ['Decentralized AI', 'AI Agents'],
    act: (n, cap) => 'Run one job on ' + n + ' for about ' + cap + ' and keep the output',
    weekly: 'run one small job through the protocol',
  },
];
function actionFor(p) {
  const cap = depositSize(p.tvl_usd);
  const found = CATEGORY_ACTIONS.find((a) => a.kinds.includes(p.category || ''));
  if (found) return { do: found.act(p.name, cap), weekly: found.weekly };
  return { do: 'Put ' + cap + ' into ' + p.name + ' and keep the position open', weekly: 'make one small deposit or transaction' };
}
function planStepsFor(p, age) {
  const action = actionFor(p);
  const cap = depositSize(p.tvl_usd);
  const hold = holdFor(age);
  const chain = (p.chains && p.chains[0]) || 'its main chain';
  const step = (text, cost, time) => text + ' Cost: ' + cost + '. Time: ' + time + '.';
  return [
    step('Start with a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline', 'under $3 of gas for the first transaction', '5 minutes'),
    step(action.do + ' on ' + chain, cap + ' of capital and about $8 of gas', '15 minutes to set up'),
    step('Do one qualifying action each week, such as ' + action.weekly, 'about $2 of gas a week', '10 minutes a week'),
    step('Keep the position open for at least ' + hold + ' days, so more than one snapshot sees the activity', 'the ' + cap + ' stays in the position', hold + ' days'),
    step('Before withdrawing, open the protocol\u2019s own points or rewards page and claim only from the link it publishes', 'no fee to check, and never pay to claim', '10 minutes to check'),
    step('After the claim, keep the wallet warm with one small transaction a month', 'about $1 of gas a month', '5 minutes a month'),
  ];
}
function splitStep(text) {
  const i = text.indexOf(' Cost: ');
  if (i < 0) return { main: text, cost: '' };
  const main = text.slice(0, i);
  const rest = text.slice(i + 7);
  const j = rest.indexOf('. Time: ');
  if (j < 0) return { main: main, cost: rest };
  return { main: main, cost: 'Cost: ' + rest.slice(0, j) + ' · Time: ' + rest.slice(j + 8).replace(/\.$/, '') };
}

/* ------------------------------------------------------------------ model
 * The same scoring lib/model.ts applies. The sandbox changes only the three weights. */
const DEFAULT_WEIGHTS = { growth: 0.5, maturity: 0.4, breadth: 0.04 };
function scoreUnder(row, settings) {
  const g = clampTo(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, -60, 150);
  const gm = 1 + (g / 100) * settings.growth;
  const age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
  const mm = 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * settings.maturity;
  const bm = 1 + settings.breadth * Math.min(Math.max((row.chains || []).length - 1, 0), 5);
  return Math.max(1, Math.round(row.tvl_usd * row.sector_multiple * gm * mm * bm));
}
function isDefaultWeights(s) {
  return s.growth === DEFAULT_WEIGHTS.growth && s.maturity === DEFAULT_WEIGHTS.maturity && s.breadth === DEFAULT_WEIGHTS.breadth;
}

/* ------------------------------------------------------------------ state */
const DATA = typeof window !== 'undefined' ? window.RADAR : null;
const WATCHLIST = new Set((DATA ? DATA.rows : []).filter((r) => r.watchlist).map((r) => r.slug));

const state = {
  q: '',
  category: '',
  chain: '',
  tab: 'pre',
  watchlistOnly: false,
  sort: 'rank',
  dir: 1,
  selected: null,
  sandbox: null,
};

function readHash() {
  if (typeof location === 'undefined') return;
  const h = new URLSearchParams(location.hash.slice(1));
  state.q = h.get('q') || '';
  state.category = h.get('category') || '';
  state.chain = h.get('chain') || '';
  state.tab = h.get('tab') === 'live' ? 'live' : 'pre';
  state.watchlistOnly = h.get('watchlist') === '1';
  state.sort = h.get('sort') || 'rank';
  state.dir = h.get('dir') === '-1' ? -1 : 1;
  state.selected = h.get('p') || null;
}
function writeHash() {
  if (typeof history === 'undefined') return;
  const h = new URLSearchParams();
  if (state.q) h.set('q', state.q);
  if (state.category) h.set('category', state.category);
  if (state.chain) h.set('chain', state.chain);
  if (state.tab !== 'pre') h.set('tab', state.tab);
  if (state.watchlistOnly) h.set('watchlist', '1');
  if (state.sort !== 'rank') h.set('sort', state.sort);
  if (state.dir === -1) h.set('dir', '-1');
  if (state.selected) h.set('p', state.selected);
  const s = h.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname);
}

/* ------------------------------------------------------------------ rows */
function displayRows() {
  const settings = state.sandbox || DEFAULT_WEIGHTS;
  let rows = state.tab === 'live' ? DATA.live.slice() : DATA.rows.slice();
  if (state.tab === 'pre') {
    rows = rows.map((r) => ({ ...r, dispImplied: scoreUnder(r, settings) }));
    rows.sort((a, b) => b.dispImplied - a.dispImplied || a.slug.localeCompare(b.slug));
    rows.forEach((r, i) => { r.dispRank = i + 1; });
  } else {
    rows.forEach((r, i) => { r.dispRank = i + 1; });
  }
  if (state.watchlistOnly && state.tab === 'pre') rows = rows.filter((r) => r.watchlist);
  if (state.category) rows = rows.filter((r) => (r.category || 'Other') === state.category);
  if (state.chain) rows = rows.filter((r) => (r.chains || []).includes(state.chain));
  if (state.q) {
    const q = state.q.toLowerCase();
    rows = rows.filter((r) => (r.name + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().includes(q));
  }
  const key = state.sort;
  const dir = state.dir;
  const val = (r) => {
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null || r.age_days === undefined ? -Infinity : r.age_days;
    if (key === 'implied') return r.dispImplied || 0;
    if (key === 'mcap') return r.mcap_usd || 0;
    return r.dispRank;
  };
  rows.sort((a, b) => {
    const d = val(a) - val(b);
    if (d !== 0) return d * dir;
    return a.dispRank - b.dispRank;
  });
  return rows;
}

/* ------------------------------------------------------------------ table */
function sortButton(label, key) {
  const active = state.sort === key;
  const arrow = active ? (state.dir === 1 ? '▲' : '▼') : '';
  return '<button data-sort="' + key + '" aria-sort="' + (active ? (state.dir === 1 ? 'ascending' : 'descending') : 'none') + '">' + esc(label) + (arrow ? ' <span class="arrow">' + arrow + '</span>' : '') + '</button>';
}
function renderTable() {
  const thead = document.getElementById('thead');
  const tbody = document.getElementById('tbody');
  const rows = displayRows();
  const maxImplied = state.tab === 'pre' ? Math.max.apply(null, rows.map((r) => r.dispImplied).concat([1])) : 1;
  if (state.tab === 'live') {
    thead.innerHTML = '<tr><th class="num">' + sortButton('Rank', 'rank') + '</th><th>Protocol</th><th class="num">' + sortButton('TVL', 'tvl') + '</th><th class="num">' + sortButton('7d', 'change') + '</th><th class="num">' + sortButton('Market cap', 'mcap') + '</th><th>Token</th></tr>';
  } else {
    thead.innerHTML = '<tr><th class="num">' + sortButton('Rank', 'rank') + '</th><th>Protocol</th><th class="num">' + sortButton('TVL', 'tvl') + '</th><th class="num">' + sortButton('7d', 'change') + '</th><th class="num">' + sortButton('Age', 'age') + '</th><th class="num">' + sortButton('Implied value', 'implied') + '</th><th>Token</th></tr>';
  }
  document.getElementById('caption').textContent = state.tab === 'live'
    ? 'Live-token protocols, biggest market cap first. These already trade: the market\u2019s own value, not a model.'
    : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.';
  if (rows.length === 0) {
    tbody.innerHTML = '';
    document.getElementById('empty').hidden = false;
  } else {
    document.getElementById('empty').hidden = true;
    tbody.innerHTML = rows.map((r) => {
      const change = r.change_7d;
      const changeCls = change === null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : '';
      const chains = (r.chains || []).slice(0, 2).join(', ');
      const badge = r.watchlist ? '<span class="badge">Watchlist</span>' : '';
      const sub = esc((r.category || 'Other') + ' on ' + chains);
      const rowCls = r.watchlist ? ' class="watch"' : '';
      if (state.tab === 'live') {
        return '<tr data-slug="' + esc(r.slug) + '"' + rowCls + '><td class="num rank">' + r.dispRank + '</td><td><div class="name">' + esc(r.name) + '</div><div class="sub">' + sub + '</div></td><td class="num">' + moneyShort(r.tvl_usd) + '</td><td class="num ' + changeCls + '">' + changeSigned(change) + '</td><td class="num">' + moneyShort(r.mcap_usd || 0) + '</td><td class="token"><span class="dot live"></span>trades</td></tr>';
      }
      const width = Math.max(2, Math.round((r.dispImplied / maxImplied) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + rowCls + '><td class="num rank">' + r.dispRank + '</td><td><div class="name">' + esc(r.name) + badge + '</div><div class="sub">' + sub + '</div></td><td class="num">' + moneyShort(r.tvl_usd) + '</td><td class="num ' + changeCls + '">' + changeSigned(change) + '</td><td class="num">' + ageShort(r.age_days) + '</td><td class="num"><span class="bar"><i style="width:' + width + 'px"></i><span>' + moneyShort(r.dispImplied) + '</span></span></td><td class="token"><span class="dot"></span>no token</td></tr>';
    }).join('');
  }
  const total = state.tab === 'live' ? DATA.live.length : DATA.rows.length;
  document.getElementById('count').textContent = rows.length + ' of ' + total + ' rows shown';
  thead.querySelectorAll('button[data-sort]').forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      writeHash();
      renderTable();
    });
  });
  tbody.querySelectorAll('tr[data-slug]').forEach((tr) => {
    tr.addEventListener('click', () => openDetail(tr.getAttribute('data-slug')));
  });
}

/* ------------------------------------------------------------------ detail */
function findRow(slug) {
  return DATA.rows.find((r) => r.slug === slug) || DATA.live.find((r) => r.slug === slug) || null;
}
function openDetail(slug) {
  const row = findRow(slug);
  if (!row) return;
  state.selected = slug;
  writeHash();
  renderDetail(row);
  const dialog = document.getElementById('detail');
  if (!dialog.open) dialog.showModal();
}
function closeDetail() {
  state.selected = null;
  writeHash();
}
function renderDetail(row) {
  const body = document.getElementById('detail-body');
  const isLive = row.mcap_usd !== null && row.mcap_usd !== undefined && !DATA.rows.includes(row);
  const chains = (row.chains || []).join(', ');
  const rankLine = isLive
    ? 'Live token · market cap rank ' + (DATA.live.findIndex((r) => r.slug === row.slug) + 1) + ' of ' + DATA.live.length
    : 'Rank ' + row.rank + ' of ' + DATA.rows.length + (row.watchlist ? ' · on the watchlist' : '');
  let html = '<p class="rankline">' + esc(rankLine) + '</p>';
  html += '<h2>' + esc(row.name) + '</h2>';
  html += '<p class="cats">' + esc((row.category || 'Other') + ' on ' + chains) + '</p>';
  if (isLive) {
    const ratio = row.tvl_usd > 0 ? row.mcap_usd / row.tvl_usd : null;
    html += '<h3>Market value</h3><dl>'
      + '<div><dt>TVL</dt><dd>' + moneyShort(row.tvl_usd) + '</dd></div>'
      + '<div><dt>Seven-day growth</dt><dd>' + changeSigned(row.change_7d) + '</dd></div>'
      + '<div><dt>Market cap</dt><dd>' + moneyShort(row.mcap_usd) + '</dd></div>'
      + '<div><dt>Market cap per TVL dollar</dt><dd>' + (ratio === null ? '—' : ratio.toFixed(3)) + '</dd></div>'
      + '</dl>';
    html += '<p class="modelnote">This protocol already trades, so the board shows the market\u2019s own value, not a model. It is listed here so the radar never confuses a traded token with a launch to come.</p>';
  } else {
    const recomputed = scoreUnder(row, DEFAULT_WEIGHTS);
    const check = recomputed === row.implied_value_usd
      ? '<p class="modelnote ok">The page recomputes this row as ' + valueFull(recomputed) + ', the same number board.json carries.</p>'
      : '<p class="modelnote">The page recomputes this row as ' + valueFull(recomputed) + '; board.json carries ' + valueFull(row.implied_value_usd) + '.</p>';
    html += '<h3>Implied value</h3><dl>'
      + '<div><dt>TVL</dt><dd>' + moneyShort(row.tvl_usd) + '</dd></div>'
      + '<div><dt>Seven-day growth</dt><dd>' + changeSigned(row.change_7d) + '</dd></div>'
      + '<div><dt>Age with no token</dt><dd>' + ageShort(row.age_days) + '</dd></div>'
      + '<div><dt>Sector multiple</dt><dd>' + multShort(row.sector_multiple) + ' <span class="muted">(' + row.sector_comps + ' live comparables)</span></dd></div>'
      + '<div><dt>Growth multiplier</dt><dd>' + multShort(row.growth_multiplier) + '</dd></div>'
      + '<div><dt>Maturity multiplier</dt><dd>' + multShort(row.maturity_multiplier) + '</dd></div>'
      + '<div><dt>Breadth multiplier</dt><dd>' + multShort(row.breadth_multiplier) + '</dd></div>'
      + '<div><dt>Implied value</dt><dd>' + valueFull(row.implied_value_usd) + '</dd></div>'
      + '</dl>';
    html += '<p class="modelnote">Model radar-2: the same function scores every protocol. This is an estimate, not a price.</p>';
    html += check;
    html += '<h3>Farm plan</h3><ol>' + planStepsFor(row, row.age_days).map((s) => {
      const part = splitStep(s);
      return '<li>' + esc(part.main) + (part.cost ? '<span class="cost">' + esc(part.cost) + '</span>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  body.innerHTML = html;
}

/* ------------------------------------------------------------------ sandbox */
function sandboxSettings() {
  return {
    growth: parseFloat(document.getElementById('in-growth').value),
    maturity: parseFloat(document.getElementById('in-maturity').value),
    breadth: parseFloat(document.getElementById('in-breadth').value),
  };
}
function applySandbox() {
  const s = sandboxSettings();
  document.getElementById('out-growth').textContent = s.growth.toFixed(2);
  document.getElementById('out-maturity').textContent = s.maturity.toFixed(2);
  document.getElementById('out-breadth').textContent = s.breadth.toFixed(2);
  const st = document.getElementById('sandbox-state');
  if (isDefaultWeights(s)) {
    state.sandbox = null;
    st.textContent = 'Showing board.json values.';
    st.classList.remove('changed');
  } else {
    state.sandbox = s;
    st.textContent = 'Sandbox values active — the ranks above are recomputed live. Reset to return to board.json.';
    st.classList.add('changed');
  }
  renderTable();
}
function resetSandbox() {
  document.getElementById('in-growth').value = String(DEFAULT_WEIGHTS.growth);
  document.getElementById('in-maturity').value = String(DEFAULT_WEIGHTS.maturity);
  document.getElementById('in-breadth').value = String(DEFAULT_WEIGHTS.breadth);
  applySandbox();
}

/* ------------------------------------------------------------------ init */
function init() {
  document.getElementById('meta').textContent = 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · model ' + DATA.model_version;
  document.getElementById('headline').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
  const covered = DATA.rows.filter((r) => r.watchlist).length;
  document.getElementById('facts').innerHTML =
    '<div><dt>Watchlist covered</dt><dd>' + covered + ' / ' + DATA.watchlist_size + '</dd></div>'
    + '<div><dt>Pre-token rows scored</dt><dd>' + DATA.board_size + '</dd></div>'
    + '<div><dt>Early rows below the floor</dt><dd>' + DATA.early_size + '</dd></div>'
    + '<div><dt>Live-token protocols set aside</dt><dd>' + DATA.live_size + '</dd></div>';
  const categories = Array.from(new Set(DATA.rows.map((r) => r.category || 'Other'))).sort();
  document.getElementById('category').innerHTML = '<option value="">All categories</option>' + categories.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
  const chains = Array.from(new Set(DATA.rows.flatMap((r) => r.chains || []))).sort();
  document.getElementById('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
  document.getElementById('sectors-body').innerHTML = DATA.sectors.map((s) => '<tr><td>' + esc(s.category) + '</td><td class="num">' + multShort(s.multiple) + '</td><td class="num">' + s.comps + '</td></tr>').join('')
    + '<tr><td>Global median — fallback when a category has fewer than 3 live comparables</td><td class="num">' + multShort(DATA.global_multiple) + '</td><td class="num">—</td></tr>';

  readHash();
  const q = document.getElementById('q');
  const category = document.getElementById('category');
  const chain = document.getElementById('chain');
  const watchlist = document.getElementById('watchlist');
  q.value = state.q;
  category.value = state.category;
  chain.value = state.chain;
  watchlist.checked = state.watchlistOnly;
  document.getElementById('tab-pre').setAttribute('aria-selected', state.tab === 'pre' ? 'true' : 'false');
  document.getElementById('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');

  q.addEventListener('input', () => { state.q = q.value; writeHash(); renderTable(); });
  category.addEventListener('change', () => { state.category = category.value; writeHash(); renderTable(); });
  chain.addEventListener('change', () => { state.chain = chain.value; writeHash(); renderTable(); });
  watchlist.addEventListener('change', () => { state.watchlistOnly = watchlist.checked; writeHash(); renderTable(); });
  document.getElementById('tab-pre').addEventListener('click', () => {
    state.tab = 'pre'; state.sort = 'rank'; state.dir = 1;
    document.getElementById('tab-pre').setAttribute('aria-selected', 'true');
    document.getElementById('tab-live').setAttribute('aria-selected', 'false');
    writeHash(); renderTable();
  });
  document.getElementById('tab-live').addEventListener('click', () => {
    state.tab = 'live'; state.sort = 'rank'; state.dir = 1;
    document.getElementById('tab-live').setAttribute('aria-selected', 'true');
    document.getElementById('tab-pre').setAttribute('aria-selected', 'false');
    writeHash(); renderTable();
  });
  document.getElementById('in-growth').addEventListener('input', applySandbox);
  document.getElementById('in-maturity').addEventListener('input', applySandbox);
  document.getElementById('in-breadth').addEventListener('input', applySandbox);
  document.getElementById('sandbox-reset').addEventListener('click', resetSandbox);
  const dialog = document.getElementById('detail');
  dialog.addEventListener('click', (e) => { if (e.target === dialog) { dialog.close(); } });
  dialog.addEventListener('close', closeDetail);

  renderTable();
  if (state.selected) {
    const row = findRow(state.selected);
    if (row) { renderDetail(row); dialog.showModal(); }
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && DATA) {
  init();
}
if (typeof window !== 'undefined') {
  window.__radarTest = { planStepsFor, scoreUnder, depositSize, holdFor, actionFor, DEFAULT_WEIGHTS };
}
