/* ================================================================
   TradeGuard - Trading Risk Calculator (v3 Live)
   ================================================================ */
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const fP = (n, d = 2) => n == null || isNaN(n) ? '—' : Number(n).toFixed(d) + '%';
const fM = (n, c = 'NT$', d = 0) => n == null || isNaN(n) ? '—' : (n < 0 ? '-' : '') + c + ' ' + fmt(Math.abs(n), d);
const gV = id => { const e = document.getElementById(id); return e ? (parseFloat(e.value) || 0) : NaN; };
const gVraw = id => { const e = document.getElementById(id); return e ? e.value : ''; };
const riskLvl = (v, s, c, d) => v >= s ? 'safe' : v >= c ? 'caution' : v >= d ? 'danger' : 'critical';
const WARN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 3.5L19.5 19h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg>';
const OK_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
const PLACEHOLDER = '<div class="results-placeholder"><p>輸入參數即可即時計算</p></div>';

// ── Central index definitions ──
const INDEX_DEFS = {
  taiex:    { name: '加權指數',  placeholder: '22000', market: 'tw', region: '台灣', chart: 'TWSE:TAIEX' },
  sp500:    { name: 'S&P 500',   placeholder: '5800',  market: 'us', region: '美國', chart: 'SP:SPX' },
  nasdaq:   { name: 'Nasdaq',    placeholder: '18000', market: 'us', region: '美國', chart: 'NASDAQ:NDX' },
  dow:      { name: '道瓊',      placeholder: '42000', market: 'us', region: '美國', chart: 'DJ:DJI' },
  sox:      { name: '費半',      placeholder: '5000',  market: 'us', region: '美國', chart: 'NASDAQ:SOX' },
  nikkei:   { name: '日經225',   placeholder: '38000', market: 'jp', region: '亞洲', chart: 'TVC:NI225' },
  kospi:    { name: 'KOSPI',     placeholder: '2500',  market: 'kr', region: '亞洲', chart: 'KRX:KOSPI' },
  shanghai: { name: '上證指數',  placeholder: '3200',  market: 'cn', region: '亞洲', chart: 'SSE:000001' },
  hsi:      { name: '恆生指數',  placeholder: '20000', market: 'hk', region: '亞洲', chart: 'TVC:HSI' },
};

// ================================================================
//  PRICE SERVICE — Multi-Provider Architecture
// ================================================================
const PriceService = {
  PROXIES: [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  ],

  async _fetchTimeout(url, ms = 8000) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), ms);
    try { const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(tid); return r; }
    catch (e) { clearTimeout(tid); throw e; }
  },

  async _proxyFetch(url, timeout = 8000) {
    try { const r = await this._fetchTimeout(url, Math.min(timeout, 4000)); if (r.ok) return r; } catch {}
    for (const mk of this.PROXIES) {
      try { const r = await this._fetchTimeout(mk(url), timeout); if (r.ok) return r; } catch {}
    }
    throw new Error('無法連線');
  },

  // ────────── PROVIDERS ──────────
  PROVIDER_INFO: {
    yahoo:    { name: 'Yahoo Finance',     desc: '全球市場 (透過代理，免金鑰)',     markets: 'tw,us', needsKey: false },
    twse:     { name: 'TWSE 證交所',       desc: '台灣即時報價 (僅台灣市場)',       markets: 'tw',    needsKey: false },
    tpex:     { name: 'TPEX 櫃買中心',     desc: '台灣上櫃即時 (僅台灣上櫃)',       markets: 'tw',    needsKey: false },
    finnhub:  { name: 'Finnhub',           desc: '美國即時 (需免費 API Key)',       markets: 'us',    needsKey: true, keyHint: '至 finnhub.io 免費註冊取得' },
  },

  // ── Yahoo Finance ──
  yahoo: {
    INDEX_MAP: { taiex: '^TWII', sp500: '^GSPC', nasdaq: '^IXIC', dow: '^DJI', sox: '^SOX', nikkei: '^N225', kospi: '^KS11', shanghai: '000001.SS', hsi: '^HSI' },
    async fetchQuote(symbol) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
      const r = await PriceService._proxyFetch(url);
      const m = (await r.json())?.chart?.result?.[0]?.meta;
      if (!m?.regularMarketPrice) throw new Error('No data');
      const price = m.regularMarketPrice, prev = m.chartPreviousClose || m.previousClose || price;
      return { price, prevClose: prev, change: price - prev, changePct: prev ? ((price - prev) / prev * 100) : 0, currency: m.currency || '', name: m.shortName || m.symbol || '' };
    },
    formatSymbol(code, market) {
      code = code.trim();
      if (market === 'tw' && !code.includes('.') && /^\d+[A-Za-z]?$/.test(code)) code += '.TW';
      return code;
    }
  },

  // ── TWSE 台灣證交所 (上市) ──
  twse: {
    INDEX_MAP: { taiex: 'tse_t00.tw' },
    async fetchQuote(symbol) {
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(symbol)}&_=${Date.now()}`;
      const r = await PriceService._proxyFetch(url);
      const items = (await r.json())?.msgArray || [];
      const item = items.find(i => i.z && i.z !== '-') || items[0];
      if (!item) throw new Error('查無資料');
      const price = parseFloat(item.z !== '-' ? item.z : '') || parseFloat(item.y) || 0;
      const prev = parseFloat(item.y) || price;
      if (!price) throw new Error('尚無成交');
      return { price, prevClose: prev, change: price - prev, changePct: prev ? ((price - prev) / prev * 100) : 0, currency: 'TWD', name: item.nf || item.n || symbol };
    },
    formatSymbol(code) {
      code = code.trim();
      if (/^\d{4,6}[A-Za-z]?$/.test(code)) return `tse_${code}.tw|otc_${code}.tw`;
      return code;
    }
  },

  // ── TPEX 台灣櫃買中心 (上櫃) ──
  tpex: {
    INDEX_MAP: {},
    async fetchQuote(symbol) {
      // TPEX uses same MIS endpoint with otc_ prefix
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(symbol)}&_=${Date.now()}`;
      const r = await PriceService._proxyFetch(url);
      const items = (await r.json())?.msgArray || [];
      const item = items.find(i => i.z && i.z !== '-') || items[0];
      if (!item) throw new Error('查無資料');
      const price = parseFloat(item.z !== '-' ? item.z : '') || parseFloat(item.y) || 0;
      const prev = parseFloat(item.y) || price;
      if (!price) throw new Error('尚無成交');
      return { price, prevClose: prev, change: price - prev, changePct: prev ? ((price - prev) / prev * 100) : 0, currency: 'TWD', name: item.nf || item.n || symbol };
    },
    formatSymbol(code) {
      code = code.trim();
      if (/^\d{4,6}[A-Za-z]?$/.test(code)) return `otc_${code}.tw`;
      return code;
    }
  },

  // ── Finnhub ──
  finnhub: {
    INDEX_MAP: { sp500: 'SPY', nasdaq: 'QQQ', dow: 'DIA', sox: 'SOXX' },
    async fetchQuote(symbol) {
      const key = CFG.finnhubKey;
      if (!key) throw new Error('需要 Finnhub API Key (請至設定填入)');
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`;
      const r = await PriceService._fetchTimeout(url, 8000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!d.c || d.c === 0) throw new Error('No data');
      return { price: d.c, prevClose: d.pc, change: d.d || 0, changePct: d.dp || 0, currency: 'USD', name: symbol };
    },
    formatSymbol(code) { return code.trim().toUpperCase(); }
  },

  // ────────── ROUTING ──────────
  _getProvider(market) {
    const src = market === 'tw' ? CFG.twSource : CFG.usSource;
    return this[src] || this.yahoo;
  },

  async fetchIndex(key) {
    const market = INDEX_DEFS[key]?.market || 'us';
    const provider = (market === 'tw' || market === 'us') ? this._getProvider(market) : this.yahoo;
    const symbol = provider.INDEX_MAP?.[key];
    if (symbol) {
      try { return await provider.fetchQuote(symbol); }
      catch (e) {
        if (provider !== this.yahoo && this.yahoo.INDEX_MAP[key]) return await this.yahoo.fetchQuote(this.yahoo.INDEX_MAP[key]);
        throw e;
      }
    }
    // Provider doesn't have this index → fallback Yahoo
    if (this.yahoo.INDEX_MAP[key]) return await this.yahoo.fetchQuote(this.yahoo.INDEX_MAP[key]);
    throw new Error(`不支援: ${key}`);
  },

  async fetchAllIndices() {
    const results = {};
    const keys = Object.keys(CFG.indices).filter(k => CFG.indices[k]);
    await Promise.all(keys.map(async key => {
      try { results[key] = await this.fetchIndex(key); }
      catch (e) { results[key] = { error: e.message }; }
    }));
    return results;
  },

  async fetchStockQuote(code, market) {
    const provider = this._getProvider(market);
    const symbol = provider.formatSymbol(code, market);
    try { return await provider.fetchQuote(symbol); }
    catch (e) {
      if (provider !== this.yahoo) {
        const yfSymbol = this.yahoo.formatSymbol(code, market);
        try { return await this.yahoo.fetchQuote(yfSymbol); } catch {}
      }
      throw e;
    }
  },

  fmtChg(q) {
    if (!q || q.error) return '';
    const s = q.change >= 0 ? '+' : '';
    return `${s}${q.change.toFixed(2)} (${s}${q.changePct.toFixed(2)}%)`;
  },

  // ── TAIFEX 期交所保證金 ──
  // API 回傳的 Contract 名稱 → FP.tw 合約代碼
  TAIFEX_CONTRACT_MAP: {
    '臺股期貨': 'TX',
    '小型臺指': 'MTX',
    '微型臺指期貨': 'MXF',
    '電子期貨': 'TE',
    '金融期貨': 'TF',
  },

  async fetchTaifexMargins() {
    const url = 'https://openapi.taifex.com.tw/v1/IndexFuturesAndOptionsMargining';
    const r = await this._proxyFetch(url, 12000);
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('無資料');

    const margins = {};
    let dataDate = '';
    for (const item of data) {
      const name = (item.Contract || '').trim();
      const code = this.TAIFEX_CONTRACT_MAP[name];
      if (!code) continue;
      const im = parseInt(String(item.InitialMargin || '0').replace(/,/g, ''));
      const mm = parseInt(String(item.MaintenanceMargin || '0').replace(/,/g, ''));
      if (!dataDate && item.Date) dataDate = item.Date;
      if (im > 0) margins[code] = { im, mm };
    }
    return { margins, date: dataDate };
  }
};

let _taifexMarginDate = '';

// ── TAIFEX margin fetch handler ──
window.fetchTaifexMarginBtn = async function() {
  const dateEl = $('#f-margin-date');
  if (dateEl) dateEl.textContent = '查詢中…';
  try {
    const { margins, date } = await PriceService.fetchTaifexMargins();
    // Update FP presets with live data
    Object.entries(margins).forEach(([code, { im, mm }]) => {
      if (FP.tw[code]) { FP.tw[code].im = im; FP.tw[code].mm = mm; }
    });
    // Format date
    const fmtDate = date ? `${date.slice(0,4)}/${date.slice(4,6)}/${date.slice(6,8)}` : '';
    _taifexMarginDate = fmtDate;
    // Update current form fields
    const contract = $('#f-contract')?.value;
    if (contract && margins[contract]) {
      $('#f-im').value = margins[contract].im;
      $('#f-mm').value = margins[contract].mm;
      // Update read-only displays
      const imD = $('#f-im-display'), mmD = $('#f-mm-display');
      if (imD) imD.textContent = fmt(margins[contract].im);
      if (mmD) mmD.textContent = fmt(margins[contract].mm);
      const activeM = $('.eq-multi-btn.active');
      const mulVal = activeM ? parseInt(activeM.dataset.mul) : 3;
      const qty = parseInt($('#f-qty')?.value) || 1;
      $('#f-equity').value = margins[contract].im * qty * mulVal;
      $('#f-im').dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (dateEl) dateEl.textContent = fmtDate ? `期交所 ${fmtDate}` : '已更新';
  } catch (e) {
    if (dateEl) dateEl.textContent = '查詢失敗';
    setTimeout(() => { if (dateEl) dateEl.textContent = _taifexMarginDate ? `期交所 ${_taifexMarginDate}` : ''; }, 3000);
  }
};

// ── Debounce ──
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Wrap number inputs with external +/− buttons ──
function wrapNumberInputs(container) {
  container.querySelectorAll('input[type="number"]').forEach(input => {
    if (input.closest('.num-wrap')) return;
    const isuf = input.closest('.isuf');
    const target = isuf || input;
    const parent = target.parentElement;

    const wrap = document.createElement('div');
    wrap.className = 'num-wrap';

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'num-btn';
    minus.textContent = '−';

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'num-btn';
    plus.textContent = '+';

    parent.insertBefore(wrap, target);
    wrap.appendChild(minus);
    wrap.appendChild(target);
    wrap.appendChild(plus);

    const getStep = () => {
      const s = parseFloat(input.step);
      if (!isNaN(s) && s > 0 && input.step !== 'any') return s;
      const v = Math.abs(parseFloat(input.value) || 0);
      if (v >= 10000) return 100;
      if (v >= 1000) return 10;
      if (v >= 10) return 1;
      return 0.5;
    };

    const adjust = (dir) => {
      const step = getStep();
      const cur = parseFloat(input.value) || 0;
      input.value = parseFloat((cur + step * dir).toFixed(4));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // Click
    minus.addEventListener('click', () => adjust(-1));
    plus.addEventListener('click', () => adjust(1));

    // Long-press: repeat while held
    let _holdTimer = null, _holdInterval = null;
    const startHold = (dir) => {
      _holdTimer = setTimeout(() => {
        _holdInterval = setInterval(() => adjust(dir), 80);
      }, 400);
    };
    const stopHold = () => { clearTimeout(_holdTimer); clearInterval(_holdInterval); };
    [minus, plus].forEach((btn, i) => {
      const dir = i === 0 ? -1 : 1;
      btn.addEventListener('pointerdown', () => startHold(dir));
      btn.addEventListener('pointerup', stopHold);
      btn.addEventListener('pointerleave', stopHold);
    });
  });
}

// ── Settings (persisted in localStorage) ──
const DEFAULT_SETTINGS = {
  autoFetch: true,
  refreshInterval: 0,
  indices: { taiex: true, sp500: true, nasdaq: true, dow: true, sox: true, nikkei: true, kospi: true, shanghai: true, hsi: true },
  defaultMarket: 'tw',
  twSource: 'twse',        // 'yahoo' | 'twse' | 'tpex'
  usSource: 'yahoo',       // 'yahoo' | 'finnhub'
  finnhubKey: '',
  chartInterval: 'D',      // '1' | '5' | '15' | '60' | 'D' | 'W' | 'M'
  chartStyle: '1',         // '1' candle | '0' bar | '2' line | '3' area | '9' heikin ashi
  fontScale: 'm',          // 'xs' | 's' | 'm' | 'l' | 'xl'
};
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('tg-settings')) || {};
    return { ...DEFAULT_SETTINGS, ...raw, indices: { ...DEFAULT_SETTINGS.indices, ...(raw.indices || {}) },
      chartInterval: raw.chartInterval || DEFAULT_SETTINGS.chartInterval,
      chartStyle: raw.chartStyle || DEFAULT_SETTINGS.chartStyle,
      fontScale: raw.fontScale || DEFAULT_SETTINGS.fontScale };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { localStorage.setItem('tg-settings', JSON.stringify(s)); }
let CFG = loadSettings();
let _refreshTimer = null;

// ── State ──
const S = {
  margin: { market: 'tw', direction: 'long', product: 'stock' },
  futures: { market: 'tw', direction: 'long' },
  options: { market: 'tw', side: 'buyer' }
};

// ── Presets ──
const FP = {
  tw: {
    TX:   { name: '臺股期貨 (大台)',    mul: 200, im: 184000, mm: 141000, u: '點' },
    MTX:  { name: '小型臺指 (小台)',    mul: 50,  im: 46000,  mm: 35250,  u: '點' },
    MXF:  { name: '微型臺指 (微台)',    mul: 10,  im: 9200,   mm: 7050,   u: '點' },
    TE:   { name: '電子期貨',          mul: 4000,im: 210000, mm: 161000, u: '點' },
    TF:   { name: '金融期貨',          mul: 1000,im: 52500,  mm: 40250,  u: '點' },
    STK:  { name: '股票期貨',          mul: 2000,im: 0,      mm: 0,      u: '元' },
  },
  us: {
    ES:  { name: 'E-mini S&P 500',    mul: 50,  im: 12650,  mm: 11500,  u: 'pts' },
    NQ:  { name: 'E-mini Nasdaq 100', mul: 20,  im: 16500,  mm: 15000,  u: 'pts' },
    MES: { name: 'Micro E-mini S&P',  mul: 5,   im: 1265,   mm: 1150,   u: 'pts' },
    MNQ: { name: 'Micro E-mini NQ',   mul: 2,   im: 1650,   mm: 1500,   u: 'pts' },
    YM:  { name: 'E-mini Dow',        mul: 5,   im: 9000,   mm: 8200,   u: 'pts' },
    MYM: { name: 'Micro E-mini Dow',  mul: 0.5, im: 900,    mm: 820,    u: 'pts' },
  }
};

const ETF_PRESETS = {
  tw: [
    { code: '0050', name: '元大台灣50', leverage: 1, index: 'taiex' },
    { code: '006208', name: '富邦台50', leverage: 1, index: 'taiex' },
    { code: '00631L', name: '元大台灣50正2', leverage: 2, index: 'taiex' },
    { code: '00632R', name: '元大台灣50反1', leverage: -1, index: 'taiex' },
    { code: '00675L', name: 'S&P500正2', leverage: 2, index: 'sp500' },
    { code: '00670L', name: '美國道瓊正2', leverage: 2, index: 'dow' },
  ],
  us: [
    { code: 'SPY', name: 'SPDR S&P 500', leverage: 1, index: 'sp500' },
    { code: 'QQQ', name: 'Invesco Nasdaq', leverage: 1, index: 'nasdaq' },
    { code: 'TQQQ', name: 'ProShares 3x QQQ', leverage: 3, index: 'nasdaq' },
    { code: 'SQQQ', name: 'ProShares -3x QQQ', leverage: -3, index: 'nasdaq' },
    { code: 'SPXL', name: 'Direxion 3x S&P', leverage: 3, index: 'sp500' },
    { code: 'UPRO', name: 'ProShares 3x S&P', leverage: 3, index: 'sp500' },
    { code: 'SOXL', name: 'Direxion 3x 費半', leverage: 3, index: 'sox' },
    { code: 'SOXS', name: 'Direxion -3x 費半', leverage: -3, index: 'sox' },
    { code: 'DIA', name: 'SPDR Dow Jones', leverage: 1, index: 'dow' },
    { code: 'UDOW', name: 'ProShares 3x Dow', leverage: 3, index: 'dow' },
  ]
};

// ── Builders ──
function subTabs(prefix, tabs, contents) {
  let h = '<div class="sub-tabs">';
  tabs.forEach((t, i) => { h += `<button class="sub-tab${i === 0 ? ' active' : ''}" data-stab="${prefix}-${i}">${t}</button>`; });
  h += '</div>';
  contents.forEach((c, i) => { h += `<div class="sub-pane${i === 0 ? ' active' : ''}" id="${prefix}-${i}">${c}</div>`; });
  return h;
}

function riskBar(label, value, statusText, level, fillPct) {
  const colors = { safe: 'var(--green)', caution: 'var(--yellow)', danger: 'var(--orange)', critical: 'var(--red)' };
  const fp = Math.max(0, Math.min(100, fillPct));
  return `<div class="risk-bar-wrap"><div class="risk-bar-info risk-${level}"><div class="risk-bar-label">${label}</div><div class="risk-bar-value">${value}</div><div class="risk-bar-status">${statusText}</div></div><div class="risk-bar-col"><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${fp}%;background:${colors[level]}"></div></div></div></div>`;
}

function alertBox(level, msg) {
  const cls = level === 'safe' ? 'alert-safe' : level === 'caution' || level === 'warning' ? 'alert-warn' : 'alert-danger';
  return `<div class="alert ${cls}">${level === 'safe' ? OK_SVG : WARN_SVG}<span>${msg}</span></div>`;
}

function mc(label, value, sub, hl) {
  return `<div class="mc${hl ? ' ' + hl : ''}"><div class="ml">${label}</div><div class="mv">${value}</div>${sub ? `<div class="ms">${sub}</div>` : ''}</div>`;
}

// ================================================================
//  BUILD TICKER BAR (dynamic from INDEX_DEFS)
// ================================================================
function buildTickerBar() {
  const container = $('#ticker-inputs');
  if (!container) return;
  container.innerHTML = Object.entries(INDEX_DEFS).map(([key, def]) => {
    const show = CFG.indices[key] !== false;
    return `<div class="ticker-item" data-idx="${key}" style="${show ? '' : 'display:none'}">
      <span class="ticker-name">${def.name}</span>
      <input type="number" id="idx-${key}" placeholder="${def.placeholder}" step="any">
      <span class="ticker-chg" id="chg-${key}"></span>
    </div>`;
  }).join('');
}

// ================================================================
//  INIT
// ================================================================
function init() {
  buildTickerBar();

  // Main tabs
  $$('.main-tab').forEach(b => b.addEventListener('click', () => {
    $$('.main-tab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $$('.tab-content').forEach(x => x.classList.remove('active'));
    $(`#tab-${b.dataset.tab}`).classList.add('active');
    if (b.dataset.tab === 'chart') initChart();
  }));

  // Toggle groups
  $$('.toggle-group').forEach(g => {
    $$('.toggle-btn', g).forEach(b => b.addEventListener('click', () => {
      $$('.toggle-btn', g).forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const gn = g.dataset.group, v = b.dataset.value;
      if (gn === 'margin-market')    { S.margin.market = v;    renderMarginForm(); }
      if (gn === 'margin-direction') { S.margin.direction = v; renderMarginForm(); }
      if (gn === 'margin-product')   { S.margin.product = v;   renderMarginForm(); }
      if (gn === 'futures-market')   { S.futures.market = v;   renderFuturesForm(); }
      if (gn === 'futures-direction'){ S.futures.direction = v; renderFuturesForm(); }
      if (gn === 'options-market')   { S.options.market = v;   renderOptionsForm(); }
      if (gn === 'options-side')     { S.options.side = v;     renderOptionsForm(); }
    }));
  });

  // Sub-tab delegation
  document.addEventListener('click', e => {
    const st = e.target.closest('.sub-tab');
    if (!st) return;
    const p = st.parentElement;
    $$('.sub-tab', p).forEach(x => x.classList.remove('active'));
    st.classList.add('active');
    const container = p.parentElement;
    $$('.sub-pane', container).forEach(x => x.classList.remove('active'));
    const pane = $(`#${st.dataset.stab}`, container);
    if (pane) pane.classList.add('active');
  });

  // ── Fetch indices button ──
  const fetchBtn = $('#btn-fetch-indices');
  if (fetchBtn) fetchBtn.addEventListener('click', handleFetchIndices);

  // ── Settings panel ──
  initSettings();

  // ── Apply default market from settings ──
  if (CFG.defaultMarket) {
    const m = CFG.defaultMarket;
    S.margin.market = m; S.futures.market = m; S.options.market = m;
    // Sync toggle buttons
    ['margin-market', 'futures-market', 'options-market'].forEach(gn => {
      const g = $(`.toggle-group[data-group="${gn}"]`);
      if (!g) return;
      $$('.toggle-btn', g).forEach(b => {
        b.classList.toggle('active', b.dataset.value === m);
      });
    });
  }

  // Render forms
  renderMarginForm();
  renderFuturesForm();
  renderOptionsForm();

  // ── LIVE CALCULATION: event delegation on each tab ──
  const liveMargin = debounce(calcMargin, 100);
  const liveFutures = debounce(calcFutures, 100);
  const liveOptions = debounce(calcOptions, 100);

  $('#tab-margin').addEventListener('input', liveMargin);
  $('#tab-margin').addEventListener('change', liveMargin);
  $('#tab-futures').addEventListener('input', liveFutures);
  $('#tab-futures').addEventListener('change', liveFutures);
  $('#tab-options').addEventListener('input', liveOptions);
  $('#tab-options').addEventListener('change', liveOptions);

  // ── 根據設定決定是否自動取報價 ──
  applySettings();
}
document.addEventListener('DOMContentLoaded', init);

// ================================================================
//  SETTINGS PANEL
// ================================================================
function initSettings() {
  const btn = $('#btn-settings');
  const overlay = $('#settings-overlay');
  const panel = $('#settings-panel');
  const closeBtn = $('#btn-settings-close');
  const open = () => { renderSettings(); panel.classList.add('open'); overlay.classList.add('open'); };
  const close = () => { panel.classList.remove('open'); overlay.classList.remove('open'); };
  if (btn) btn.addEventListener('click', open);
  if (overlay) overlay.addEventListener('click', close);
  if (closeBtn) closeBtn.addEventListener('click', close);
}

function renderSettings() {
  const body = $('#settings-body');
  if (!body) return;
  const P = PriceService.PROVIDER_INFO;
  // Group indices by region
  const regionOrder = ['台灣', '美國', '亞洲'];
  const grouped = {};
  Object.entries(INDEX_DEFS).forEach(([k, def]) => {
    if (!grouped[def.region]) grouped[def.region] = [];
    grouped[def.region].push({ key: k, name: def.name });
  });
  const cbHtml = regionOrder.filter(r => grouped[r]).map(region =>
    `<div class="stg-cb-region"><span class="stg-cb-region-label">${region}</span>${
      grouped[region].map(({ key, name }) =>
        `<label class="stg-cb"><input type="checkbox" data-idx="${key}" ${CFG.indices[key] ? 'checked' : ''}>${name}</label>`
      ).join('')
    }</div>`
  ).join('');

  // Build provider options for each market
  const twOpts = Object.entries(P).filter(([,v]) => v.markets.includes('tw')).map(([id, v]) =>
    `<option value="${id}" ${CFG.twSource === id ? 'selected' : ''}>${v.name}</option>`).join('');
  const usOpts = Object.entries(P).filter(([,v]) => v.markets.includes('us')).map(([id, v]) =>
    `<option value="${id}" ${CFG.usSource === id ? 'selected' : ''}>${v.name}</option>`).join('');

  body.innerHTML = `
    <div class="stg-section">
      <h4>報價來源</h4>
      <div class="stg-row">
        <label>台灣市場<span class="stg-hint" id="stg-tw-desc">${P[CFG.twSource]?.desc || ''}</span></label>
        <select class="stg-select" id="stg-tw-source">${twOpts}</select>
      </div>
      <div class="stg-row">
        <label>美國市場<span class="stg-hint" id="stg-us-desc">${P[CFG.usSource]?.desc || ''}</span></label>
        <select class="stg-select" id="stg-us-source">${usOpts}</select>
      </div>
      <div class="stg-row" id="stg-finnhub-row" style="display:${CFG.usSource === 'finnhub' ? '' : 'none'}">
        <label>Finnhub API Key<span class="stg-hint">至 finnhub.io 免費註冊取得</span></label>
        <input type="text" class="stg-input" id="stg-finnhub-key" value="${CFG.finnhubKey}" placeholder="輸入 API Key" spellcheck="false">
      </div>
    </div>
    <div class="stg-section">
      <h4>即時報價</h4>
      <div class="stg-row">
        <label>進入頁面自動取得報價<span class="stg-hint">載入時自動查詢指數行情</span></label>
        <label class="stg-toggle"><input type="checkbox" id="stg-auto-fetch" ${CFG.autoFetch ? 'checked' : ''}><span class="slider"></span></label>
      </div>
      <div class="stg-row">
        <label>自動更新間隔<span class="stg-hint">定時重新取得報價</span></label>
        <select class="stg-select" id="stg-refresh">
          <option value="0" ${CFG.refreshInterval === 0 ? 'selected' : ''}>關閉</option>
          <option value="30" ${CFG.refreshInterval === 30 ? 'selected' : ''}>30 秒</option>
          <option value="60" ${CFG.refreshInterval === 60 ? 'selected' : ''}>1 分鐘</option>
          <option value="300" ${CFG.refreshInterval === 300 ? 'selected' : ''}>5 分鐘</option>
          <option value="600" ${CFG.refreshInterval === 600 ? 'selected' : ''}>10 分鐘</option>
        </select>
      </div>
    </div>
    <div class="stg-section">
      <h4>顯示指數</h4>
      <div class="stg-cb-group">${cbHtml}</div>
    </div>
    <div class="stg-section">
      <h4>預設市場</h4>
      <div class="stg-row">
        <label>開啟頁面時的預設市場</label>
        <select class="stg-select" id="stg-default-market">
          <option value="tw" ${CFG.defaultMarket === 'tw' ? 'selected' : ''}>台灣</option>
          <option value="us" ${CFG.defaultMarket === 'us' ? 'selected' : ''}>美國</option>
        </select>
      </div>
    </div>
    <div class="stg-section">
      <h4>K線圖表</h4>
      <div class="stg-row">
        <label>預設週期<span class="stg-hint">圖表預設時間週期</span></label>
        <select class="stg-select" id="stg-chart-interval">
          <option value="1" ${CFG.chartInterval === '1' ? 'selected' : ''}>1 分鐘</option>
          <option value="5" ${CFG.chartInterval === '5' ? 'selected' : ''}>5 分鐘</option>
          <option value="15" ${CFG.chartInterval === '15' ? 'selected' : ''}>15 分鐘</option>
          <option value="60" ${CFG.chartInterval === '60' ? 'selected' : ''}>1 小時</option>
          <option value="D" ${CFG.chartInterval === 'D' ? 'selected' : ''}>日線</option>
          <option value="W" ${CFG.chartInterval === 'W' ? 'selected' : ''}>週線</option>
          <option value="M" ${CFG.chartInterval === 'M' ? 'selected' : ''}>月線</option>
        </select>
      </div>
      <div class="stg-row">
        <label>圖表樣式<span class="stg-hint">K線顯示方式</span></label>
        <select class="stg-select" id="stg-chart-style">
          <option value="1" ${CFG.chartStyle === '1' ? 'selected' : ''}>K線 (陰陽燭)</option>
          <option value="0" ${CFG.chartStyle === '0' ? 'selected' : ''}>美國線 (Bar)</option>
          <option value="2" ${CFG.chartStyle === '2' ? 'selected' : ''}>折線</option>
          <option value="3" ${CFG.chartStyle === '3' ? 'selected' : ''}>面積圖</option>
          <option value="9" ${CFG.chartStyle === '9' ? 'selected' : ''}>平均K線 (Heikin Ashi)</option>
        </select>
      </div>
    </div>
    <div class="stg-section">
      <h4>字體大小</h4>
      <div class="stg-row">
        <label>全站字體縮放<span class="stg-hint">調整所有文字大小</span></label>
        <select class="stg-select" id="stg-font-scale">
          <option value="xs" ${CFG.fontScale === 'xs' ? 'selected' : ''}>極小</option>
          <option value="s" ${CFG.fontScale === 's' ? 'selected' : ''}>小</option>
          <option value="m" ${CFG.fontScale === 'm' ? 'selected' : ''}>中 (預設)</option>
          <option value="l" ${CFG.fontScale === 'l' ? 'selected' : ''}>大</option>
          <option value="xl" ${CFG.fontScale === 'xl' ? 'selected' : ''}>極大</option>
        </select>
      </div>
    </div>`;

  // Update descriptions & show/hide Finnhub key row on source change
  const syncUI = () => {
    const tw = $('#stg-tw-source')?.value || 'twse';
    const us = $('#stg-us-source')?.value || 'yahoo';
    const tdesc = $('#stg-tw-desc'), udesc = $('#stg-us-desc'), frow = $('#stg-finnhub-row');
    if (tdesc) tdesc.textContent = P[tw]?.desc || '';
    if (udesc) udesc.textContent = P[us]?.desc || '';
    if (frow) frow.style.display = us === 'finnhub' ? '' : 'none';
  };
  $('#stg-tw-source')?.addEventListener('change', syncUI);
  $('#stg-us-source')?.addEventListener('change', syncUI);

  // Bind events — save on every change
  const save = () => {
    CFG.twSource = $('#stg-tw-source')?.value || 'twse';
    CFG.usSource = $('#stg-us-source')?.value || 'yahoo';
    CFG.finnhubKey = $('#stg-finnhub-key')?.value?.trim() || '';
    CFG.autoFetch = $('#stg-auto-fetch')?.checked ?? true;
    CFG.refreshInterval = parseInt($('#stg-refresh')?.value || '0', 10);
    CFG.defaultMarket = $('#stg-default-market')?.value || 'tw';
    CFG.chartInterval = $('#stg-chart-interval')?.value || 'D';
    CFG.chartStyle = $('#stg-chart-style')?.value || '1';
    CFG.fontScale = $('#stg-font-scale')?.value || 'm';
    $$('[data-idx]', body).forEach(cb => { CFG.indices[cb.dataset.idx] = cb.checked; });
    saveSettings(CFG);
    applySettings();
  };
  body.addEventListener('change', save);
  $('#stg-finnhub-key')?.addEventListener('input', debounce(save, 500));
}

function applySettings() {
  // Apply font scale
  document.documentElement.setAttribute('data-font-scale', CFG.fontScale || 'm');

  // Show/hide ticker items based on settings
  Object.entries(CFG.indices).forEach(([k, show]) => {
    const item = $(`.ticker-item[data-idx="${k}"]`);
    if (item) item.style.display = show ? '' : 'none';
  });

  // Auto-fetch on load (only trigger once per page load)
  if (CFG.autoFetch && !applySettings._fetched) {
    applySettings._fetched = true;
    handleFetchIndices();
    // Also auto-fetch TAIFEX margins
    fetchTaifexMarginBtn();
  }

  // Refresh timer
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
  if (CFG.refreshInterval > 0) {
    _refreshTimer = setInterval(handleFetchIndices, CFG.refreshInterval * 1000);
  }
}
applySettings._fetched = false;

// ================================================================
//  K-LINE CHART (TradingView)
// ================================================================
let _chartInited = false;
let _chartSymbol = 'TWSE:TAIEX';

function initChart() {
  if (_chartInited) return;
  _chartInited = true;

  // Quick buttons
  $$('.chart-qbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.chart-qbtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadChart(btn.dataset.sym);
    });
  });

  // Search
  const input = $('#chart-sym-input');
  const goBtn = $('#chart-go-btn');
  const go = () => {
    let sym = input?.value?.trim();
    if (!sym) return;
    if (/^\d{4,6}[A-Za-z]?$/.test(sym)) sym = `TWSE:${sym}`;
    else if (/^[A-Za-z]+$/.test(sym)) sym = sym.toUpperCase();
    $$('.chart-qbtn').forEach(b => b.classList.remove('active'));
    loadChart(sym);
  };
  if (goBtn) goBtn.addEventListener('click', go);
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

  loadChart(_chartSymbol);
}

function loadChart(symbol) {
  _chartSymbol = symbol;
  const container = document.getElementById('tv-chart');
  if (!container) return;
  container.innerHTML = '';

  // Direct iframe embed — bypasses JS widget restrictions (works from file:// too)
  const config = {
    autosize: true,
    symbol: symbol,
    interval: CFG.chartInterval || 'D',
    timezone: 'Asia/Taipei',
    theme: 'dark',
    style: CFG.chartStyle || '1',
    locale: 'zh_TW',
    allow_symbol_change: true,
    calendar: false,
    hide_volume: false,
    support_host: 'https://www.tradingview.com'
  };

  const iframe = document.createElement('iframe');
  iframe.src = 'https://s.tradingview.com/embed-widget/advanced-chart/?locale=zh_TW#' + encodeURIComponent(JSON.stringify(config));
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block';
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('allowtransparency', 'true');
  iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-forms');
  container.appendChild(iframe);

  // Update "open in TradingView" link
  const tvLink = document.getElementById('chart-tv-link');
  if (tvLink) tvLink.href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

// Allow other tabs to open chart for a symbol
window.openChart = function(symbol) {
  _chartSymbol = symbol;
  // Switch to chart tab
  $$('.main-tab').forEach(x => x.classList.remove('active'));
  const chartTabBtn = $(`.main-tab[data-tab="chart"]`);
  if (chartTabBtn) chartTabBtn.classList.add('active');
  $$('.tab-content').forEach(x => x.classList.remove('active'));
  $('#tab-chart')?.classList.add('active');
  $$('.chart-qbtn').forEach(b => b.classList.remove('active'));
  initChart();
  loadChart(symbol);
};

// ================================================================
//  FETCH INDEX PRICES
// ================================================================
async function handleFetchIndices() {
  const btn = $('#btn-fetch-indices');
  if (!btn || btn.classList.contains('loading')) return;
  btn.classList.add('loading');
  btn.querySelector('span').textContent = '載入中…';

  try {
    const results = await PriceService.fetchAllIndices();
    let ok = 0, fail = 0;
    for (const [key, q] of Object.entries(results)) {
      const input = $(`#idx-${key}`);
      const chgEl = $(`#chg-${key}`);
      const item = input?.closest('.ticker-item');
      if (q.error) { fail++; if (chgEl) chgEl.textContent = ''; continue; }
      ok++;
      if (input) {
        input.value = q.price.toFixed(2);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (chgEl) {
        chgEl.textContent = PriceService.fmtChg(q);
        chgEl.className = `ticker-chg ${q.change >= 0 ? 'up' : 'down'}`;
      }
      if (item) item.classList.add('has-data');
    }
    btn.querySelector('span').textContent = ok > 0 ? `已更新 ${ok}筆` : '更新失敗';
    // Auto-fill form fields from updated ticker values
    if (ok > 0) {
      if ($('#f-entry') && !gV('f-entry')) fillFromTicker('f-entry');
      if ($('#f-current') && !gV('f-current')) fillFromTicker('f-current');
      if ($('#o-ul') && !gV('o-ul')) fillOptFromTicker();
    }
    // Show timestamp
    let timeEl = $('.ticker-time');
    if (!timeEl) { timeEl = document.createElement('span'); timeEl.className = 'ticker-time'; btn.parentElement.appendChild(timeEl); }
    timeEl.textContent = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    btn.querySelector('span').textContent = '更新失敗';
  }
  btn.classList.remove('loading');
  setTimeout(() => { btn.querySelector('span').textContent = '即時報價'; }, 3000);
}

// ================================================================
//  FETCH INDIVIDUAL STOCK PRICE
// ================================================================
async function handleFetchStock() {
  const symbolInput = $('#m-symbol');
  const infoEl = $('#m-stock-info');
  const fetchBtn = $('#m-fetch-stock');
  if (!symbolInput || !symbolInput.value.trim()) return;

  const market = S.margin.market;
  if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = '查詢中…'; }
  if (infoEl) infoEl.innerHTML = '<span class="tm">查詢中…</span>';

  try {
    const q = await PriceService.fetchStockQuote(symbolInput.value, market);
    const chgCls = q.change >= 0 ? 'price-up' : 'price-down';
    const chgStr = PriceService.fmtChg(q);
    const code = symbolInput.value.trim();
    const tvSym = market === 'tw' && /^\d{4,6}[A-Za-z]?$/.test(code) ? `TWSE:${code}` : code.toUpperCase();
    if (infoEl) infoEl.innerHTML = `<strong>${q.name || code}</strong> <span class="${chgCls}">${q.price.toFixed(2)} ${chgStr}</span> <a href="#" onclick="openChart('${tvSym}');return false;" style="color:var(--accent);font-size:.66rem;margin-left:4px">K線圖</a>`;

    // Fill price into the correct field
    const long = S.margin.direction === 'long';
    const priceField = $(long ? '#m-buy-price' : '#m-sell-price');
    if (priceField) {
      priceField.value = q.price.toFixed(2);
      priceField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Also fill "目前價格"
    const curField = $('#m-current-price');
    if (curField && !curField.value) {
      curField.value = q.price.toFixed(2);
      curField.dispatchEvent(new Event('input', { bubbles: true }));
    }
  } catch (e) {
    if (infoEl) infoEl.innerHTML = `<span class="tr">${e.message}</span>`;
  }
  if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '查詢'; }
}

// ================================================================
//  MARGIN FORM
// ================================================================
function renderMarginForm() {
  const { market, direction, product } = S.margin;
  const tw = market === 'tw', long = direction === 'long';
  const cur = tw ? 'NT$' : 'USD';
  const su = tw ? '張 (1張=1000股)' : '股';

  let extra = '';
  if (product === 'etf') {
    const presets = ETF_PRESETS[market] || [];
    const etfOpts = presets.filter(p => Math.abs(p.leverage) === 1).map(p => `<option value="${p.code}">${p.code} ${p.name}</option>`).join('');
    extra = `<div class="fg"><label>指數ETF</label><select id="m-etf-select"><option value="">-- 選擇ETF --</option>${etfOpts}</select></div>`;
  } else if (product === 'letf') {
    const presets = ETF_PRESETS[market] || [];
    const letfOpts = presets.filter(p => Math.abs(p.leverage) > 1).map(p => `<option value="${p.code}" data-lev="${p.leverage}">${p.code} ${p.name} (${p.leverage}x)</option>`).join('');
    extra = `
      <div class="fg"><label>槓桿ETF</label><select id="m-etf-select"><option value="">-- 選擇槓桿ETF --</option>${letfOpts}</select></div>
      <div class="fg"><label>ETF槓桿倍數 <span class="hint">(含ETF本身的槓桿)</span></label><input type="number" id="m-etf-lev" value="2" step="any"></div>
    `;
  }

  const priceLabel = long ? '買進價格' : '賣出價格';
  const priceId = long ? 'm-buy-price' : 'm-sell-price';
  const marginId = long ? 'm-margin-rate' : 'm-short-margin-rate';
  const marginOpts = long
    ? (tw ? '<option value="0.6">60%</option><option value="0.5">50%</option><option value="0.4">40%</option>'
         : '<option value="0.5">50% Reg T</option><option value="0.7">70%</option><option value="0.6">60%</option>')
    : (tw ? '<option value="0.9">90%</option><option value="1.0">100%</option><option value="1.2">120%</option>'
         : '<option value="0.5">50% Reg T</option><option value="0.6">60%</option>');
  const defCall = long ? (tw ? 130 : 25) : (tw ? 130 : 30);
  const defForced = long ? (tw ? 120 : 20) : (tw ? 120 : 25);

  const symbolHint = tw ? '例: 2330、0050' : '例: AAPL、MSFT';
  const h = `
    <div class="fg"><label>股票代號 <span class="hint">${symbolHint}</span></label>
      <div class="stock-search-row"><input type="text" id="m-symbol" placeholder="${tw ? '代號 (如 2330)' : 'Symbol (AAPL)'}"><button type="button" class="mini-fetch-btn" id="m-fetch-stock">查詢</button></div>
      <div class="stock-info" id="m-stock-info"></div>
    </div>
    ${extra}
    <div class="fr">
      <div class="fg"><label>${priceLabel} <span class="hint">(${cur})</span></label><input type="number" id="${priceId}" placeholder="${tw ? '100' : '150'}" step="any"></div>
      <div class="fg"><label>目前價格 <span class="hint">(留空=同進場)</span></label><input type="number" id="m-current-price" placeholder="即時價格" step="any"></div>
    </div>
    <div class="fr">
      <div class="fg"><label>數量 <span class="hint">${su}</span></label><input type="number" id="m-qty" value="1" min="1" step="1"></div>
      <div class="fg"><label>${long ? (tw ? '融資成數' : 'Margin') : (tw ? '券保證金成數' : 'Short Margin')}</label><select id="${marginId}">${marginOpts}</select></div>
    </div>
    <div class="fr">
      <div class="fg"><label>追繳線</label><div class="isuf"><input type="number" id="m-call-rate" value="${defCall}" step="any"><span class="suf">%</span></div></div>
      <div class="fg"><label>斷頭線</label><div class="isuf"><input type="number" id="m-forced-rate" value="${defForced}" step="any"><span class="suf">%</span></div></div>
    </div>
    ${tw ? `<div class="fr">
      <div class="fg"><label>手續費折扣</label><select id="m-fee-disc">
        <option value="1">全額 0.1425%</option><option value="0.6">6折 0.0855%</option>
        <option value="0.5" selected>5折 0.07125%</option><option value="0.38">3.8折</option>
        <option value="0.28">2.8折 0.0399%</option><option value="0">免手續費</option>
      </select></div>
      <div class="fg"><label>證交稅(賣出)</label><select id="m-tax-rate">
        <option value="0.003"${product === 'stock' ? ' selected' : ''}>0.3% 股票</option>
        <option value="0.001"${product !== 'stock' ? ' selected' : ''}>0.1% ETF</option>
        <option value="0.0015">0.15% 當沖減半</option>
      </select></div>
    </div>
    <div class="fr">
      <div class="fg"><label>${long ? '融資年利率' : '借券費率(年)'}</label><div class="isuf"><input type="number" id="m-int-rate" value="${long ? '6.25' : '0.5'}" step="any"><span class="suf">%</span></div></div>
      <div class="fg"><label>持有天數</label><input type="number" id="m-hold-days" value="30" min="0" step="1"></div>
    </div>` : `<div class="fr">
      <div class="fg"><label>Commission <span class="hint">(per trade)</span></label><input type="number" id="m-comm" value="0" step="any"></div>
      <div class="fg"><label>Holding Days</label><input type="number" id="m-hold-days" value="30" min="0" step="1"></div>
    </div>
    <div class="fg"><label>Margin Interest Rate</label><div class="isuf"><input type="number" id="m-int-rate" value="${long ? '8' : '3'}" step="any"><span class="suf">%/yr</span></div></div>`}
  `;

  $('#margin-inputs').innerHTML = h;
  $('#margin-results').innerHTML = PLACEHOLDER;

  if (product === 'letf') {
    const sel = $('#m-etf-select');
    if (sel) sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      if (opt && opt.dataset.lev) $('#m-etf-lev').value = opt.dataset.lev;
    });
  }

  // Wire stock search
  const fetchStockBtn = $('#m-fetch-stock');
  if (fetchStockBtn) fetchStockBtn.addEventListener('click', handleFetchStock);
  const symbolInput = $('#m-symbol');
  if (symbolInput) symbolInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleFetchStock(); });

  wrapNumberInputs($('#margin-inputs'));
}

// ================================================================
//  MARGIN CALC
// ================================================================
function calcMargin() {
  const { market, direction, product } = S.margin;
  const tw = market === 'tw', long = direction === 'long';
  const cur = tw ? 'NT$' : 'USD';
  const spu = tw ? 1000 : 1;
  const qty = gV('m-qty'), ts = qty * spu;
  const cr = gV('m-call-rate') / 100, fr = gV('m-forced-rate') / 100;
  const etfLev = product === 'letf' ? (gV('m-etf-lev') || 1) : 1;

  // Fee inputs
  const holdDays = gV('m-hold-days') || 0;
  const intRate = (gV('m-int-rate') || 0) / 100;

  if (long) {
    const bp = gV('m-buy-price'), mr = parseFloat($('#m-margin-rate')?.value || '0.5');
    let cp = gV('m-current-price'); if (!cp) cp = bp;
    if (!bp || !qty) { $('#margin-results').innerHTML = PLACEHOLDER; return; }

    const lps = bp * mr, eps = bp * (1 - mr), tl = lps * ts, te = eps * ts;
    const tc = bp * ts, cv = cp * ts, upl = (cp - bp) * ts, ce = cv - tl;

    // Fee calculation
    let buyFee, sellFee, sellTax, interest, totalFees;
    if (tw) {
      const disc = parseFloat($('#m-fee-disc')?.value || '0.5');
      const feeRate = 0.001425 * disc;
      const taxRate = parseFloat($('#m-tax-rate')?.value || '0.003');
      buyFee = Math.max(20, tc * feeRate);
      sellFee = Math.max(20, cv * feeRate);
      sellTax = cv * taxRate;
      interest = tl * intRate * holdDays / 365;
    } else {
      const comm = gV('m-comm') || 0;
      buyFee = comm; sellFee = comm;
      sellTax = cv * 0.0000278; // SEC fee
      interest = tl * intRate * holdDays / 365;
    }
    totalFees = buyFee + sellFee + sellTax + interest;
    const netPL = upl - totalFees;
    const lev = tc / te, effectiveLev = lev * Math.abs(etfLev);
    let maint, callP, forcedP;
    if (tw) { maint = cv / tl; callP = lps * cr; forcedP = lps * fr; }
    else { maint = ce / cv; callP = lps / (1 - cr); forcedP = lps / (1 - fr); }

    const rl = tw ? riskLvl(maint * 100, 166, 140, cr * 100) : riskLvl(maint * 100, 40, 30, cr * 100);
    const mp = maint * 100, fillPct = tw ? Math.min(100, (mp - 100) / 100 * 100) : Math.min(100, mp);
    const dC = bp - callP, dCP = dC / bp * 100, dF = bp - forcedP, dFP = dF / bp * 100;
    const dCur = cp - callP, dCurP = dCur / cp * 100;
    const statusMap = { safe: '安全', caution: '注意', danger: '追繳', critical: '斷頭' };
    const alertMsg = { safe: '維持率充足，風險可控。', caution: '接近追繳邊緣！', danger: tw ? '已觸發追繳！T+2 日內需補繳。' : 'Margin call!', critical: tw ? '已達斷頭標準！' : 'Forced liquidation!' };
    const plH = upl >= 0 ? 'h-green' : 'h-red', plS = upl >= 0 ? '+' : '', eqRet = ((ce - te) / te * 100).toFixed(1);

    const overview = `
      ${alertBox(rl === 'safe' ? 'safe' : rl === 'caution' ? 'warning' : 'danger', alertMsg[rl])}
      ${riskBar(tw ? '擔保維持率' : 'Margin Ratio', fP(mp), statusMap[rl], rl, fillPct)}
      <div class="mg">
        ${mc(tw ? '融資金額' : 'Loan', fM(tl, cur), `每股 ${fM(lps, cur, 2)}`)}
        ${mc(tw ? '自備款' : 'Equity', fM(te, cur), `每股 ${fM(eps, cur, 2)}`)}
        ${mc('槓桿倍數', effectiveLev.toFixed(2) + 'x', product === 'letf' ? `融資${lev.toFixed(1)}x × ETF${etfLev}x` : `±1% → 權益±${lev.toFixed(1)}%`, 'h-accent')}
        ${mc('未實現損益(税前)', plS + fM(upl, cur), `權益 ${fM(ce, cur)} (${eqRet}%)`, plH)}
        ${totalFees > 0 ? mc('交易成本合計', fM(totalFees, cur), [
          tw ? `手續費 ${fM(buyFee + sellFee, cur)}` : `Comm ${fM(buyFee + sellFee, cur)}`,
          `${tw ? '證交稅' : 'SEC Fee'} ${fM(sellTax, cur)}`,
          interest > 0 ? `${tw ? '融資利息' : 'Interest'}(${holdDays}天) ${fM(interest, cur)}` : ''
        ].filter(Boolean).join(' / '), 'h-yellow') : ''}
        ${totalFees > 0 ? mc('淨損益(税後)', (netPL >= 0 ? '+' : '') + fM(netPL, cur), `報酬率 ${(netPL / te * 100).toFixed(1)}%`, netPL >= 0 ? 'h-green' : 'h-red') : ''}
        ${mc('追繳價格', fM(callP, cur, 2), `從買價跌 ${fM(dC, cur, 2)} (${fP(dCP)})`, rl !== 'safe' ? 'h-yellow' : '')}
        ${mc('斷頭價格', fM(forcedP, cur, 2), `從買價跌 ${fM(dF, cur, 2)} (${fP(dFP)})`, rl === 'critical' ? 'h-red' : '')}
        ${mc('距追繳可跌(從目前)', dCur > 0 ? fM(dCur, cur, 2) : '已追繳!', dCur > 0 ? fP(dCurP) : '')}
        ${mc('目前市值', fM(cv, cur), `成本 ${fM(tc, cur)}`)}
      </div>`;

    const steps = [30, 25, 20, 15, 10, 5, 0, -5, -10, -15, -20, -25, -30, -35, -40, -45, -50];
    let sRows = '';
    for (const p of steps) {
      const pr = bp * (1 + p / 100), diff = pr - bp, v = pr * ts, eq = v - tl;
      let mr2 = tw ? v / tl : eq / v;
      const u = (pr - bp) * ts;
      const lvl = tw ? riskLvl(mr2 * 100, 166, cr * 100 + 10, cr * 100) : riskLvl(mr2 * 100, 40, cr * 100 + 5, cr * 100);
      let st2 = '', rc2 = '';
      if (tw) { if (mr2 < fr) { st2 = '斷頭'; rc2 = 'rf'; } else if (mr2 < cr) { st2 = '追繳'; rc2 = 'rmc'; } else st2 = '安全'; }
      else { if (mr2 < fr) { st2 = 'Liq'; rc2 = 'rf'; } else if (mr2 < cr) { st2 = 'Call'; rc2 = 'rmc'; } else st2 = 'OK'; }
      if (p === 0) rc2 = 'rc';
      const sc = lvl === 'safe' ? 'sb-s' : lvl === 'caution' ? 'sb-c' : lvl === 'danger' ? 'sb-d' : 'sb-x';
      const diffStr = (diff >= 0 ? '+' : '') + fM(diff, cur, 2);
      sRows += `<tr class="${rc2}"><td>${p > 0 ? '+' : ''}${p}%<br><span class="tm">${diffStr}</span></td><td>${fM(pr, cur, 2)}</td><td class="${u >= 0 ? 'tg' : 'tr'}">${u >= 0 ? '+' : ''}${fM(u, cur)}</td><td>${fM(eq, cur)}</td><td class="${mr2 < cr ? 'tr' : ''}">${fP(mr2 * 100)}</td><td><span class="sb ${sc}">${st2}</span></td></tr>`;
    }
    const stress = `<div class="st-wrap"><table class="st"><thead><tr><th>漲跌</th><th>股價</th><th>損益</th><th>權益</th><th>${tw ? '維持率' : 'Margin%'}</th><th>狀態</th></tr></thead><tbody>${sRows}</tbody></table></div>`;

    const formula = tw ? `<div class="fc">
      <div class="fb"><h4>1. 融資金額與自備款</h4>
        <span class="fl"><span class="v">融資金額/股</span> <span class="o">=</span> 買進價格(<span class="n">${fM(bp,cur,2)}</span>) <span class="o">×</span> 融資成數(<span class="n">${(mr*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(lps,cur,2)}</span></span>
        <span class="fl"><span class="v">自備款/股</span> <span class="o">=</span> 買進價格(<span class="n">${fM(bp,cur,2)}</span>) <span class="o">×</span> (1−融資成數)(<span class="n">${((1-mr)*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(eps,cur,2)}</span></span>
        <span class="fl"><span class="v">融資總額</span> <span class="o">=</span> 融資金額/股(<span class="n">${fM(lps,cur,2)}</span>) <span class="o">×</span> 股數(<span class="n">${fmt(ts)}</span>) <span class="o">=</span> <span class="r">${fM(tl,cur)}</span></span>
        <span class="fl"><span class="v">自備款總額</span> <span class="o">=</span> 自備款/股(<span class="n">${fM(eps,cur,2)}</span>) <span class="o">×</span> 股數(<span class="n">${fmt(ts)}</span>) <span class="o">=</span> <span class="r">${fM(te,cur)}</span></span>
        <span class="fl"><span class="v">總成本</span> <span class="o">=</span> 融資(<span class="n">${fM(tl,cur)}</span>) <span class="o">+</span> 自備(<span class="n">${fM(te,cur)}</span>) <span class="o">=</span> <span class="r">${fM(tc,cur)}</span></span>
      </div>
      <div class="fb"><h4>2. 槓桿倍數</h4>
        <span class="fl"><span class="v">槓桿</span> <span class="o">=</span> 總成本(<span class="n">${fM(tc,cur)}</span>) <span class="o">÷</span> 自備款(<span class="n">${fM(te,cur)}</span>) <span class="o">=</span> <span class="r">${lev.toFixed(2)}x</span></span>
        ${product !== 'stock' ? `<span class="fl"><span class="v">有效槓桿</span> <span class="o">=</span> 融資槓桿(<span class="n">${lev.toFixed(2)}x</span>) <span class="o">×</span> ETF槓桿(<span class="n">${etfLev}x</span>) <span class="o">=</span> <span class="r">${effectiveLev.toFixed(2)}x</span></span>
        <div class="fn">指數跌1% → ETF跌${Math.abs(etfLev)}% → 權益跌${effectiveLev.toFixed(1)}%</div>` : `<div class="fn">每漲跌1%，權益變動${lev.toFixed(1)}%</div>`}
      </div>
      <div class="fb"><h4>3. 擔保維持率</h4>
        <span class="fl"><span class="v">目前市值</span> <span class="o">=</span> 目前價格(<span class="n">${fM(cp,cur,2)}</span>) <span class="o">×</span> 股數(<span class="n">${fmt(ts)}</span>) <span class="o">=</span> <span class="r">${fM(cv,cur)}</span></span>
        <span class="fl"><span class="v">維持率</span> <span class="o">=</span> 市值(<span class="n">${fM(cv,cur)}</span>) <span class="o">÷</span> 融資金額(<span class="n">${fM(tl,cur)}</span>) <span class="o">=</span> <span class="r">${fP(mp)}</span></span>
        <div class="fn">< ${(cr*100).toFixed(0)}% → 追繳 (須於 T+2 日補繳)　< ${(fr*100).toFixed(0)}% → 斷頭 (券商強制賣出)</div>
      </div>
      <div class="fb"><h4>4. 未實現損益</h4>
        <span class="fl"><span class="v">損益</span> <span class="o">=</span> (目前價格(<span class="n">${fM(cp,cur,2)}</span>) <span class="o">−</span> 買進價格(<span class="n">${fM(bp,cur,2)}</span>)) <span class="o">×</span> 股數(<span class="n">${fmt(ts)}</span>) <span class="o">=</span> <span class="r">${plS}${fM(upl,cur)}</span></span>
        <span class="fl"><span class="v">權益</span> <span class="o">=</span> 市值(<span class="n">${fM(cv,cur)}</span>) <span class="o">−</span> 融資金額(<span class="n">${fM(tl,cur)}</span>) <span class="o">=</span> <span class="r">${fM(ce,cur)}</span></span>
        <span class="fl"><span class="v">權益報酬率</span> <span class="o">=</span> (權益(<span class="n">${fM(ce,cur)}</span>) <span class="o">−</span> 自備(<span class="n">${fM(te,cur)}</span>)) <span class="o">÷</span> 自備(<span class="n">${fM(te,cur)}</span>) <span class="o">=</span> <span class="r">${eqRet}%</span></span>
      </div>
      <div class="fb"><h4>5. 追繳 & 斷頭價格</h4>
        <span class="fl"><span class="v">追繳價</span> <span class="o">=</span> 融資金額/股(<span class="n">${fM(lps,cur,2)}</span>) <span class="o">×</span> 追繳線(<span class="n">${cr}</span>) <span class="o">=</span> <span class="r">${fM(callP,cur,2)}</span></span>
        <span class="fl">　從買進價跌 <span class="r">${fM(dC,cur,2)}</span> (<span class="r">${fP(dCP)}</span>)，距目前價可跌 <span class="r">${dCur > 0 ? fM(dCur,cur,2) : '已追繳!'}</span></span>
        <span class="fl"><span class="v">斷頭價</span> <span class="o">=</span> 融資金額/股(<span class="n">${fM(lps,cur,2)}</span>) <span class="o">×</span> 斷頭線(<span class="n">${fr}</span>) <span class="o">=</span> <span class="r">${fM(forcedP,cur,2)}</span></span>
        <span class="fl">　從買進價跌 <span class="r">${fM(dF,cur,2)}</span> (<span class="r">${fP(dFP)}</span>)</span>
      </div>
      <div class="fb"><h4>6. 券商處置流程</h4>
        <span class="fl">① <span class="v">維持率 < ${(cr*100).toFixed(0)}% (追繳線)</span>：券商發出<strong>追繳通知</strong>，投資人須在 <strong>T+2 日</strong> 收盤前補繳差額，使維持率回到 166% 以上。</span>
        <span class="fl">② <span class="v">逾期未補繳 或 維持率 < ${(fr*100).toFixed(0)}% (斷頭線)</span>：券商有權在次一營業日以市價<strong>強制賣出</strong>全部融資股票（俗稱「斷頭」），賣出後之餘額（扣除融資本息及手續費等）退還投資人；若不足，投資人仍需補繳差額。</span>
        <span class="fl">③ <span class="v">盤中急跌</span>：若盤中維持率急跌至斷頭線以下，部分券商可能在<strong>盤中即時</strong>執行斷頭，不待 T+2 補繳期限。</span>
        <div class="fn">實際追繳時程與斷頭規則以各券商信用交易契約為準，上述為一般慣例。</div>
      </div>
    </div>` : `<div class="fc">
      <div class="fb"><h4>1. Loan & Equity</h4>
        <span class="fl"><span class="v">Loan/share</span> <span class="o">=</span> Buy Price(<span class="n">${fM(bp,cur,2)}</span>) <span class="o">×</span> Margin Rate(<span class="n">${(mr*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(lps,cur,2)}</span></span>
        <span class="fl"><span class="v">Equity/share</span> <span class="o">=</span> Buy Price(<span class="n">${fM(bp,cur,2)}</span>) <span class="o">×</span> (1−Rate)(<span class="n">${((1-mr)*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(eps,cur,2)}</span></span>
        <span class="fl"><span class="v">Total Loan</span> <span class="o">=</span> <span class="n">${fM(lps,cur,2)}</span> <span class="o">×</span> <span class="n">${fmt(ts)}</span> shares <span class="o">=</span> <span class="r">${fM(tl,cur)}</span></span>
      </div>
      <div class="fb"><h4>2. Margin Ratio</h4>
        <span class="fl"><span class="v">Market Value</span> <span class="o">=</span> Current Price(<span class="n">${fM(cp,cur,2)}</span>) <span class="o">×</span> Shares(<span class="n">${fmt(ts)}</span>) <span class="o">=</span> <span class="r">${fM(cv,cur)}</span></span>
        <span class="fl"><span class="v">Equity</span> <span class="o">=</span> Value(<span class="n">${fM(cv,cur)}</span>) <span class="o">−</span> Loan(<span class="n">${fM(tl,cur)}</span>) <span class="o">=</span> <span class="r">${fM(ce,cur)}</span></span>
        <span class="fl"><span class="v">Margin%</span> <span class="o">=</span> Equity(<span class="n">${fM(ce,cur)}</span>) <span class="o">÷</span> Value(<span class="n">${fM(cv,cur)}</span>) <span class="o">=</span> <span class="r">${fP(mp)}</span></span>
        <div class="fn">FINRA minimum: 25%. Most brokers require 30-40%.</div>
      </div>
      <div class="fb"><h4>3. Margin Call & Liquidation</h4>
        <span class="fl"><span class="v">Call Price</span> <span class="o">=</span> Loan(<span class="n">${fM(lps,cur,2)}</span>) <span class="o">÷</span> (1 − Maint%)(<span class="n">${(1-cr).toFixed(2)}</span>) <span class="o">=</span> <span class="r">${fM(callP,cur,2)}</span></span>
        <span class="fl"><span class="v">Forced Liq</span> <span class="o">=</span> Loan(<span class="n">${fM(lps,cur,2)}</span>) <span class="o">÷</span> (1 − Liq%)(<span class="n">${(1-fr).toFixed(2)}</span>) <span class="o">=</span> <span class="r">${fM(forcedP,cur,2)}</span></span>
      </div>
      <div class="fb"><h4>4. Broker Actions</h4>
        <span class="fl">① <span class="v">Equity% < ${(cr*100).toFixed(0)}% (Maintenance)</span>: Broker issues a <strong>margin call</strong>. You must deposit cash or securities within <strong>2-5 business days</strong> (varies by broker) to bring equity back above the maintenance requirement.</span>
        <span class="fl">② <span class="v">Failure to meet call / Equity% < ${(fr*100).toFixed(0)}%</span>: Broker may <strong>force-sell</strong> some or all positions <strong>without prior notice</strong> to cover the shortfall. Any remaining deficit is still owed.</span>
        <span class="fl">③ <span class="v">Rapid decline</span>: Under FINRA rules, brokers can liquidate <strong>immediately</strong> during extreme market conditions without waiting for the call period to expire.</span>
        <div class="fn">FINRA minimum maintenance: 25%. Most brokers set 30-40%. Actual rules per your broker agreement.</div>
      </div>
    </div>`;

    $('#margin-results').innerHTML = subTabs('mr', ['風險概覽', '壓力測試', '計算公式'], [overview, stress, formula]);

  } else {
    // ── SHORT ──
    const sp = gV('m-sell-price'), smr = parseFloat($('#m-short-margin-rate')?.value || '0.9');
    let cp = gV('m-current-price'); if (!cp) cp = sp;
    if (!sp || !qty) { $('#margin-results').innerHTML = PLACEHOLDER; return; }

    const dep = sp * smr, col = sp, tg2 = (dep + col) * ts, cv = cp * ts, upl = (sp - cp) * ts;

    // Fee calculation (short)
    let openFee, closeFee, openTax, borrowFee, totalFees;
    if (tw) {
      const disc = parseFloat($('#m-fee-disc')?.value || '0.5');
      const feeRate = 0.001425 * disc;
      const taxRate = parseFloat($('#m-tax-rate')?.value || '0.003');
      openFee = Math.max(20, sp * ts * feeRate);   // 融券賣出手續費
      closeFee = Math.max(20, cp * ts * feeRate);   // 回補買進手續費
      openTax = sp * ts * taxRate;                   // 賣出證交稅
      borrowFee = sp * ts * intRate * holdDays / 365; // 借券費
    } else {
      const comm = gV('m-comm') || 0;
      openFee = comm; closeFee = comm;
      openTax = sp * ts * 0.0000278; // SEC fee on sell
      borrowFee = sp * ts * intRate * holdDays / 365; // borrow fee
    }
    totalFees = openFee + closeFee + openTax + borrowFee;
    const netPL = upl - totalFees;
    let maint, callP, forcedP;
    if (tw) { maint = (dep + col) / cp; callP = (dep + col) / cr; forcedP = (dep + col) / fr; }
    else { maint = (col + dep - cp) / cp; callP = (col + dep) / (1 + cr); forcedP = (col + dep) / (1 + fr); }
    const ce = (dep + col - cp) * ts;
    const rl = tw ? riskLvl(maint * 100, 166, 140, cr * 100) : riskLvl(maint * 100, 50, 35, cr * 100);
    const mp = maint * 100, fillPct = tw ? Math.min(100, (mp - 100) / 100 * 100) : Math.min(100, mp);
    const rC = callP - sp, rCP = rC / sp * 100;
    const statusMap = { safe: '安全', caution: '注意', danger: '追繳', critical: '斷頭' };
    const plH = upl >= 0 ? 'h-green' : 'h-red', plS = upl >= 0 ? '+' : '';

    const overview = `
      ${alertBox(rl === 'safe' ? 'safe' : rl === 'caution' ? 'warning' : 'danger', rl === 'safe' ? '做空部位安全' : rl === 'caution' ? '接近追繳邊緣' : '已觸發追繳/斷頭！')}
      ${riskBar(tw ? '擔保維持率' : 'Margin Ratio', fP(mp), statusMap[rl], rl, fillPct)}
      <div class="mg">
        ${mc(tw ? '融券保證金' : 'Margin Deposit', fM(dep * ts, cur), `${(smr * 100).toFixed(0)}% × 賣出價`)}
        ${mc(tw ? '融券擔保品' : 'Short Proceeds', fM(sp * ts, cur))}
        ${mc('總擔保', fM(tg2, cur), '保證金 + 擔保品')}
        ${mc('做空損益(税前)', plS + fM(upl, cur), `權益 ${fM(ce, cur)}`, plH)}
        ${totalFees > 0 ? mc('交易成本合計', fM(totalFees, cur), [
          tw ? `手續費 ${fM(openFee + closeFee, cur)}` : `Comm ${fM(openFee + closeFee, cur)}`,
          `${tw ? '證交稅' : 'SEC Fee'} ${fM(openTax, cur)}`,
          borrowFee > 0 ? `${tw ? '借券費' : 'Borrow'}(${holdDays}天) ${fM(borrowFee, cur)}` : ''
        ].filter(Boolean).join(' / '), 'h-yellow') : ''}
        ${totalFees > 0 ? mc('淨損益(税後)', (netPL >= 0 ? '+' : '') + fM(netPL, cur), '', netPL >= 0 ? 'h-green' : 'h-red') : ''}
        ${mc('追繳價(股價漲到)', fM(callP, cur, 2), `上漲 ${fP(rCP)}`, 'h-yellow')}
        ${mc('斷頭價', fM(forcedP, cur, 2), '', 'h-red')}
      </div>`;

    const steps = [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60];
    let sRows = '';
    for (const p of steps) {
      const pr = sp * (1 + p / 100), diff = pr - sp;
      let mr2 = tw ? (dep + col) / pr : (col + dep - pr) / pr;
      const u = (sp - pr) * ts;
      let st2 = '', rc2 = '';
      if (mr2 < fr) { st2 = tw ? '斷頭' : 'Liq'; rc2 = 'rf'; } else if (mr2 < cr) { st2 = tw ? '追繳' : 'Call'; rc2 = 'rmc'; } else st2 = tw ? '安全' : 'OK';
      if (p === 0) rc2 = 'rc';
      const lvl = tw ? riskLvl(mr2 * 100, 166, 140, cr * 100) : riskLvl(mr2 * 100, 50, 35, cr * 100);
      const sc = lvl === 'safe' ? 'sb-s' : lvl === 'caution' ? 'sb-c' : lvl === 'danger' ? 'sb-d' : 'sb-x';
      const diffStr = (diff >= 0 ? '+' : '') + fM(diff, cur, 2);
      sRows += `<tr class="${rc2}"><td>${p > 0 ? '+' : ''}${p}%<br><span class="tm">${diffStr}</span></td><td>${fM(pr, cur, 2)}</td><td class="${u >= 0 ? 'tg' : 'tr'}">${u >= 0 ? '+' : ''}${fM(u, cur)}</td><td class="${mr2 < cr ? 'tr' : ''}">${fP(mr2 * 100)}</td><td><span class="sb ${sc}">${st2}</span></td></tr>`;
    }
    const stress = `<div class="st-wrap"><table class="st"><thead><tr><th>漲跌</th><th>股價</th><th>做空損益</th><th>維持率</th><th>狀態</th></tr></thead><tbody>${sRows}</tbody></table></div>`;

    const formula = tw ? `<div class="fc">
      <div class="fb"><h4>1. 保證金與擔保品</h4>
        <span class="fl"><span class="v">融券保證金/股</span> <span class="o">=</span> 賣出價格(<span class="n">${fM(sp,cur,2)}</span>) <span class="o">×</span> 保證金成數(<span class="n">${(smr*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(dep,cur,2)}</span></span>
        <span class="fl"><span class="v">融券擔保品/股</span> <span class="o">=</span> 賣出價格(<span class="n">${fM(sp,cur,2)}</span>) <span class="o">=</span> <span class="r">${fM(col,cur,2)}</span></span>
        <span class="fl"><span class="v">每股合計</span> <span class="o">=</span> 保證金(<span class="n">${fM(dep,cur,2)}</span>) <span class="o">+</span> 擔保品(<span class="n">${fM(col,cur,2)}</span>) <span class="o">=</span> <span class="r">${fM(dep+col,cur,2)}</span></span>
        <span class="fl"><span class="v">總擔保</span> <span class="o">=</span> 每股合計(<span class="n">${fM(dep+col,cur,2)}</span>) <span class="o">×</span> 股數(<span class="n">${fmt(ts)}</span>) <span class="o">=</span> <span class="r">${fM(tg2,cur)}</span></span>
      </div>
      <div class="fb"><h4>2. 擔保維持率</h4>
        <span class="fl"><span class="v">維持率</span> <span class="o">=</span> (保證金+擔保品)(<span class="n">${fM(dep+col,cur,2)}</span>) <span class="o">÷</span> 目前價格(<span class="n">${fM(cp,cur,2)}</span>) <span class="o">=</span> <span class="r">${fP(mp)}</span></span>
        <div class="fn">< ${(cr*100).toFixed(0)}% → 追繳 (須於 T+2 日補繳)　< ${(fr*100).toFixed(0)}% → 斷頭 (券商強制回補)</div>
      </div>
      <div class="fb"><h4>3. 做空損益</h4>
        <span class="fl"><span class="v">損益</span> <span class="o">=</span> (賣出價(<span class="n">${fM(sp,cur,2)}</span>) <span class="o">−</span> 目前價(<span class="n">${fM(cp,cur,2)}</span>)) <span class="o">×</span> 股數(<span class="n">${fmt(ts)}</span>) <span class="o">=</span> <span class="r">${plS}${fM(upl,cur)}</span></span>
        <span class="fl"><span class="v">權益</span> <span class="o">=</span> 總擔保(<span class="n">${fM(tg2,cur)}</span>) <span class="o">−</span> 目前市值(<span class="n">${fM(cv,cur)}</span>) <span class="o">=</span> <span class="r">${fM(ce,cur)}</span></span>
      </div>
      <div class="fb"><h4>4. 追繳 & 斷頭價格</h4>
        <span class="fl"><span class="v">追繳價(股價漲到)</span> <span class="o">=</span> 每股合計(<span class="n">${fM(dep+col,cur,2)}</span>) <span class="o">÷</span> 追繳線(<span class="n">${(cr*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(callP,cur,2)}</span></span>
        <span class="fl">　從賣出價上漲 <span class="r">${fM(rC,cur,2)}</span> (<span class="r">${fP(rCP)}</span>)</span>
        <span class="fl"><span class="v">斷頭價</span> <span class="o">=</span> 每股合計(<span class="n">${fM(dep+col,cur,2)}</span>) <span class="o">÷</span> 斷頭線(<span class="n">${(fr*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(forcedP,cur,2)}</span></span>
      </div>
      <div class="fb"><h4>5. 券商處置流程</h4>
        <span class="fl">① <span class="v">維持率 < ${(cr*100).toFixed(0)}% (追繳線)</span>：券商發出<strong>追繳通知</strong>，投資人須在 <strong>T+2 日</strong> 收盤前補繳保證金差額，使維持率回到 166% 以上。</span>
        <span class="fl">② <span class="v">逾期未補繳 或 維持率 < ${(fr*100).toFixed(0)}% (斷頭線)</span>：券商有權在次一營業日以市價<strong>強制回補</strong>（買進股票歸還借券），即「軋空斷頭」。回補後若有虧損，投資人仍需補繳差額。</span>
        <span class="fl">③ <span class="v">強制回補日</span>：除追繳斷頭外，融券亦有<strong>強制回補日</strong>（如股東會前 6 個營業日），屆時無論盈虧均須回補。</span>
        <div class="fn">實際規則以各券商信用交易契約為準。融券做空須注意借券費、強制回補日等額外成本與風險。</div>
      </div>
    </div>` : `<div class="fc">
      <div class="fb"><h4>1. Short Margin & Collateral</h4>
        <span class="fl"><span class="v">Margin Deposit</span> <span class="o">=</span> Sell Price(<span class="n">${fM(sp,cur,2)}</span>) <span class="o">×</span> Rate(<span class="n">${(smr*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(dep,cur,2)}</span></span>
        <span class="fl"><span class="v">Sale Proceeds</span> <span class="o">=</span> <span class="r">${fM(col,cur,2)}</span></span>
        <span class="fl"><span class="v">Total Collateral</span> <span class="o">=</span> Deposit(<span class="n">${fM(dep,cur,2)}</span>) <span class="o">+</span> Proceeds(<span class="n">${fM(col,cur,2)}</span>) <span class="o">=</span> <span class="r">${fM(dep+col,cur,2)}</span></span>
      </div>
      <div class="fb"><h4>2. Margin Ratio</h4>
        <span class="fl"><span class="v">Margin%</span> <span class="o">=</span> (Proceeds+Deposit−Price)(<span class="n">${fM(col+dep-cp,cur,2)}</span>) <span class="o">÷</span> Price(<span class="n">${fM(cp,cur,2)}</span>) <span class="o">=</span> <span class="r">${fP(mp)}</span></span>
        <div class="fn">FINRA minimum: 30%. Most brokers require 30-40%.</div>
      </div>
      <div class="fb"><h4>3. Margin Call & Liquidation</h4>
        <span class="fl"><span class="v">Call Price</span> <span class="o">=</span> (Proceeds+Deposit)(<span class="n">${fM(col+dep,cur,2)}</span>) <span class="o">÷</span> (1+Maint%)(<span class="n">${(1+cr).toFixed(2)}</span>) <span class="o">=</span> <span class="r">${fM(callP,cur,2)}</span></span>
        <span class="fl"><span class="v">Forced Liq</span> <span class="o">=</span> (Proceeds+Deposit)(<span class="n">${fM(col+dep,cur,2)}</span>) <span class="o">÷</span> (1+Liq%)(<span class="n">${(1+fr).toFixed(2)}</span>) <span class="o">=</span> <span class="r">${fM(forcedP,cur,2)}</span></span>
      </div>
      <div class="fb"><h4>4. Broker Actions</h4>
        <span class="fl">① <span class="v">Equity% < ${(cr*100).toFixed(0)}%</span>: Broker issues a <strong>margin call</strong>. Deposit additional cash/securities within <strong>2-5 business days</strong>.</span>
        <span class="fl">② <span class="v">Failure to meet call</span>: Broker may <strong>buy-to-cover</strong> (force close) your short position <strong>without notice</strong>.</span>
        <span class="fl">③ <span class="v">Hard-to-borrow / Recall</span>: The lender may <strong>recall shares at any time</strong>, forcing a buy-to-cover regardless of P&L. Short interest and borrow cost can spike without warning.</span>
        <div class="fn">FINRA minimum for short: 30%. Actual rules per your broker agreement.</div>
      </div>
    </div>`;

    $('#margin-results').innerHTML = subTabs('mr', ['風險概覽', '壓力測試', '計算公式'], [overview, stress, formula]);
  }
}

// ================================================================
//  FUTURES FORM
// ================================================================
function renderFuturesForm() {
  const { market } = S.futures;
  const tw = market === 'tw', cur = tw ? 'NT$' : 'USD';
  const presets = FP[market];
  const opts = Object.entries(presets).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  const fk = Object.keys(presets)[0], f = presets[fk];

  const h = `
    <div class="fr">
      <div class="fg"><label>合約類型</label><select id="f-contract">${opts}</select></div>
      <div class="fg"><label>口數</label><input type="number" id="f-qty" value="1" min="1" step="1"></div>
    </div>
    <div class="fr">
      <div class="fg"><label>進場${tw ? '點數' : '價格'}</label><input type="number" id="f-entry" placeholder="${tw ? '20000' : '5000'}" step="any">
        <div style="display:flex;gap:3px;margin-top:2px;flex-wrap:wrap"><button type="button" class="ticker-fill-btn" onclick="fillFromTicker('f-entry')">行情帶入</button><button type="button" class="ticker-fill-btn" onclick="fetchFuturesPrice('f-entry')">API查詢</button></div>
      </div>
      <div class="fg"><label>目前${tw ? '點數' : '價格'} <span class="hint">(留空=同進場)</span></label><input type="number" id="f-current" placeholder="即時報價" step="any">
        <div style="display:flex;gap:3px;margin-top:2px;flex-wrap:wrap"><button type="button" class="ticker-fill-btn" onclick="fillFromTicker('f-current')">行情帶入</button><button type="button" class="ticker-fill-btn" onclick="fetchFuturesPrice('f-current')">API查詢</button></div>
      </div>
    </div>
    <input type="hidden" id="f-im" value="${f.im}"><input type="hidden" id="f-mm" value="${f.mm}"><input type="hidden" id="f-mul" value="${f.mul}">
    <div class="margin-info">
      <span class="mi-item"><span class="mi-label">原始保證金</span><span class="mi-val" id="f-im-display">${fmt(f.im)}</span></span>
      <span class="mi-sep">|</span>
      <span class="mi-item"><span class="mi-label">維持保證金</span><span class="mi-val" id="f-mm-display">${fmt(f.mm)}</span></span>
      <span class="mi-sep">|</span>
      <span class="mi-item"><span class="mi-label">每點價值</span><span class="mi-val" id="f-mul-display">${cur} ${fmt(f.mul)}</span></span>
      ${tw ? `<button type="button" class="ticker-fill-btn" onclick="fetchTaifexMarginBtn()" style="margin-left:auto">期交所</button>
      <span id="f-margin-date" style="font-size:.62rem;color:var(--t3)">${_taifexMarginDate ? _taifexMarginDate : ''}</span>` : ''}
    </div>
    <div class="fr">
      <div class="fg"><label>手續費 <span class="hint">(${cur}/口·單邊)</span></label><input type="number" id="f-comm" value="${tw ? '60' : '2.25'}" step="any"></div>
      <div class="fg"><label>期交稅率</label><select id="f-tax-rate">
        ${tw ? `<option value="0.00002" selected>十萬分之二(指數)</option><option value="0.00004">十萬分之四(股票)</option>` : `<option value="0" selected>無</option>`}
      </select></div>
    </div>
    <div class="fg"><label>初始權益數 <span class="hint">(預設=3倍保證金)</span></label><input type="number" id="f-equity" value="${f.im * 3}" step="any">
      <div class="eq-multi-row">
        <button type="button" class="eq-multi-btn" data-mul="1">1x</button>
        <button type="button" class="eq-multi-btn" data-mul="2">2x</button>
        <button type="button" class="eq-multi-btn active" data-mul="3">3x</button>
        <button type="button" class="eq-multi-btn" data-mul="4">4x</button>
        <button type="button" class="eq-multi-btn" data-mul="5">5x</button>
      </div>
    </div>`;

  $('#futures-inputs').innerHTML = h;
  $('#futures-results').innerHTML = PLACEHOLDER;

  // Wire contract change to update margin presets
  $('#f-contract').addEventListener('change', () => {
    const mk = S.futures.market, c = mk === 'tw' ? 'NT$' : 'USD';
    const p = FP[mk][$('#f-contract').value];
    if (p) {
      $('#f-im').value = p.im; $('#f-mm').value = p.mm; $('#f-mul').value = p.mul;
      // Update read-only displays
      const imD = $('#f-im-display'), mmD = $('#f-mm-display'), mulD = $('#f-mul-display');
      if (imD) imD.textContent = fmt(p.im);
      if (mmD) mmD.textContent = fmt(p.mm);
      if (mulD) mulD.textContent = c + ' ' + fmt(p.mul);
      const activeM = $('.eq-multi-btn.active');
      const mulVal = activeM ? parseInt(activeM.dataset.mul) : 3;
      const qty = parseInt($('#f-qty')?.value) || 1;
      $('#f-equity').value = p.im * qty * mulVal;
      $('#f-im').dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Show margin date if available
    const dateEl = $('#f-margin-date');
    if (dateEl && _taifexMarginDate) dateEl.textContent = '期交所 ' + _taifexMarginDate;
  });

  // Wire equity multiplier buttons (1x~5x)
  const updateEquity = (mulVal) => {
    const im = parseFloat($('#f-im')?.value) || 0;
    const qty = parseInt($('#f-qty')?.value) || 1;
    $('#f-equity').value = im * qty * mulVal;
    $('#f-equity').dispatchEvent(new Event('input', { bubbles: true }));
    $$('.eq-multi-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.mul) === mulVal));
  };
  $$('.eq-multi-btn').forEach(btn => {
    btn.addEventListener('click', () => updateEquity(parseInt(btn.dataset.mul)));
  });

  // Auto-fill entry & current from ticker bar
  fillFromTicker('f-entry');
  fillFromTicker('f-current');

  wrapNumberInputs($('#futures-inputs'));
}

window.fetchFuturesPrice = async function(targetId) {
  const mk = S.futures.market;
  const contract = $('#f-contract')?.value || '';
  const indexKeyMap = {
    tw: { TX: 'taiex', MTX: 'taiex', MXF: 'taiex', TE: 'taiex', TF: 'taiex', STK: '' },
    us: { ES: 'sp500', MES: 'sp500', NQ: 'nasdaq', MNQ: 'nasdaq', YM: 'dow', MYM: 'dow' }
  };
  const idxKey = indexKeyMap[mk]?.[contract];
  if (!idxKey) return;
  const el = document.getElementById(targetId);
  if (!el) return;
  el.placeholder = '查詢中…';
  try {
    const q = await PriceService.fetchIndex(idxKey);
    el.value = q.price.toFixed(2);
    el.placeholder = mk === 'tw' ? '即時報價' : 'Live price';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    el.placeholder = '查詢失敗';
    setTimeout(() => { el.placeholder = '即時報價'; }, 2000);
  }
};

window.fillFromTicker = function(targetId) {
  const mk = S.futures.market;
  const contract = $('#f-contract')?.value || '';
  let idxId = 'idx-taiex';
  if (mk === 'us') {
    if (['ES', 'MES'].includes(contract)) idxId = 'idx-sp500';
    else if (['NQ', 'MNQ'].includes(contract)) idxId = 'idx-nasdaq';
    else if (['YM', 'MYM'].includes(contract)) idxId = 'idx-dow';
    else idxId = 'idx-sp500';
  }
  const v = gV(idxId);
  if (v) { document.getElementById(targetId).value = v; document.getElementById(targetId).dispatchEvent(new Event('input', { bubbles: true })); }
};

// ================================================================
//  FUTURES CALC (with custom initial equity)
// ================================================================
function calcFutures() {
  const { market, direction } = S.futures;
  const tw = market === 'tw', long = direction === 'long';
  const cur = tw ? 'NT$' : 'USD';
  const entry = gV('f-entry'), qty = gV('f-qty'), im = gV('f-im'), mm = gV('f-mm'), mul = gV('f-mul');
  let curr = gV('f-current'); if (!curr) curr = entry;
  if (!entry || !qty || !im || !mul) { $('#futures-results').innerHTML = PLACEHOLDER; return; }

  // Fee calculation
  const fComm = gV('f-comm') || 0;
  const fTaxRate = parseFloat($('#f-tax-rate')?.value || '0');
  const commTotal = fComm * qty * 2; // round trip
  const entryTax = entry * mul * qty * fTaxRate;
  const exitTax = curr * mul * qty * fTaxRate;
  const taxTotal = entryTax + exitTax;
  const futFees = commTotal + taxTotal;

  const tIM = im * qty;   // 所需原始保證金
  const tMM = mm * qty;   // 所需維持保證金

  // ★ 初始權益數: 使用者輸入 or 預設=3倍原始保證金
  const rawEq = gVraw('f-equity');
  const initEq = rawEq !== '' ? parseFloat(rawEq) : tIM * 3;
  const excessMargin = initEq - tIM;  // 超額保證金

  const pd = long ? (curr - entry) : (entry - curr);
  const upl = pd * mul * qty;
  const eq = initEq + upl;           // ★ 權益數 = 初始權益 + 損益
  const ri = tIM > 0 ? (eq / tIM * 100) : 0;  // 風險指標 (分母仍是所需原始保證金)
  const ppm = mul * qty;              // 每點損益

  // ★ 追繳: 權益數 < 維持保證金
  // initEq + (callLevel - entry) * mul * qty * dir = tMM
  const maxLossToCall = initEq - tMM;
  const ptToCall = ppm > 0 ? maxLossToCall / ppm : 0;
  const callLvl = long ? entry - ptToCall : entry + ptToCall;

  // ★ 砍倉: 風險指標 ≤ 25%  → eq = 0.25 * tIM
  const maxLossToForced = initEq - 0.25 * tIM;
  const ptToForced = ppm > 0 ? maxLossToForced / ppm : 0;
  const forcedLvl = long ? entry - ptToForced : entry + ptToForced;

  const dC = long ? curr - callLvl : callLvl - curr;
  const dF = long ? curr - forcedLvl : forcedLvl - curr;

  let rl;
  if (ri <= 25) rl = 'critical';
  else if (eq <= tMM) rl = 'danger';
  else if (ri <= 50) rl = 'caution';
  else rl = 'safe';

  const u = FP[market][$('#f-contract')?.value]?.u || '點';
  const cn = FP[market][$('#f-contract')?.value]?.name || '';
  const statusMap = { safe: '安全', caution: '注意', danger: '追繳', critical: '砍倉' };
  const fillPct = Math.min(100, Math.max(0, ri));
  const plH = upl >= 0 ? 'h-green' : 'h-red', plS = upl >= 0 ? '+' : '';

  const overview = `
    ${alertBox(rl === 'safe' ? 'safe' : rl === 'caution' ? 'warning' : 'danger',
      rl === 'safe' ? '風險指標充足' : rl === 'caution' ? '風險指標偏低，接近追繳' : rl === 'danger' ? '權益數 < 維持保證金！需補繳至原始保證金水位' : '風險指標 ≤ 25%，可強制砍倉！')}
    ${riskBar('風險指標', fP(ri), statusMap[rl], rl, fillPct)}
    <div class="mg">
      ${mc('合約', cn, `${long ? '做多' : '做空'} ${qty}口 @ ${fmt(entry)} ${u}`)}
      ${mc('初始權益數', fM(initEq, cur), excessMargin > 0 ? `超額 ${fM(excessMargin, cur)}` : excessMargin < 0 ? `不足 ${fM(-excessMargin, cur)}` : '= 原始保證金', excessMargin > 0 ? 'h-accent' : excessMargin < 0 ? 'h-red' : '')}
      ${mc('所需原始保證金', fM(tIM, cur), `每口 ${fM(im, cur)}`)}
      ${mc('所需維持保證金', fM(tMM, cur), `每口 ${fM(mm, cur)}`)}
      ${mc('未實現損益(税前)', plS + fM(upl, cur), `${pd >= 0 ? '+' : ''}${fmt(pd, 2)} ${u}`, plH)}
      ${futFees > 0 ? mc('交易成本', fM(futFees, cur), `手續費 ${fM(commTotal, cur)} / ${tw ? '期交稅' : 'Tax'} ${fM(taxTotal, cur)}`, 'h-yellow') : ''}
      ${futFees > 0 ? mc('淨損益(税後)', (upl - futFees >= 0 ? '+' : '') + fM(upl - futFees, cur), '', (upl - futFees) >= 0 ? 'h-green' : 'h-red') : ''}
      ${mc('目前權益數', fM(eq, cur), '初始權益 + 損益', eq <= tMM ? 'h-red' : 'h-accent')}
      ${mc('追繳點位', fmt(callLvl, 2) + ' ' + u, dC > 0 ? `距目前 ${fmt(dC, 2)} ${u} (${fP(dC / curr * 100)})` : '已追繳!', 'h-yellow')}
      ${mc('砍倉點位(RI≤25%)', fmt(forcedLvl, 2) + ' ' + u, dF > 0 ? `距目前 ${fmt(dF, 2)} ${u} (${fP(dF / curr * 100)})` : '已砍倉!', 'h-red')}
      ${mc('每點損益', fM(ppm, cur), `${mul} × ${qty}口`)}
      ${mc('可承受虧損(至追繳)', fM(maxLossToCall, cur), `${fmt(ptToCall, 2)} ${u}`)}
    </div>`;

  // Stress test: now using initEq instead of tIM
  const steps = [10, 8, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -8, -10, -12, -15, -20];
  let sRows = '';
  for (const p of steps) {
    const lv = entry * (1 + p / 100), diff = lv - entry;
    const d2 = long ? lv - entry : entry - lv;
    const pl = d2 * mul * qty;
    const e2 = initEq + pl;            // ★ using initEq
    const r2 = tIM > 0 ? (e2 / tIM * 100) : 0;
    let st = '', rc = '', sc = 'sb-s';
    if (r2 <= 25) { st = '砍倉'; rc = 'rf'; sc = 'sb-x'; }
    else if (e2 <= tMM) { st = '追繳'; rc = 'rmc'; sc = 'sb-d'; }
    else if (r2 <= 50) { st = '注意'; sc = 'sb-c'; }
    else st = '安全';
    if (p === 0) rc = 'rc';
    const diffStr = (diff >= 0 ? '+' : '') + fmt(diff, 2) + ' ' + u;
    sRows += `<tr class="${rc}"><td>${p > 0 ? '+' : ''}${p}%<br><span class="tm">${diffStr}</span></td><td>${fmt(lv, 2)}</td><td class="${pl >= 0 ? 'tg' : 'tr'}">${pl >= 0 ? '+' : ''}${fM(pl, cur)}</td><td>${fM(e2, cur)}</td><td class="${r2 <= 25 ? 'tr' : r2 <= 50 ? 'ty' : ''}">${fP(r2)}</td><td><span class="sb ${sc}">${st}</span></td></tr>`;
  }
  const stress = `<div class="st-wrap"><table class="st"><thead><tr><th>漲跌</th><th>${u}</th><th>損益</th><th>權益數</th><th>風險指標</th><th>狀態</th></tr></thead><tbody>${sRows}</tbody></table></div>`;

  const formula = `<div class="fc">
    <div class="fb"><h4>1. 保證金 vs 初始權益</h4>
      <span class="fl"><span class="v">所需原始保證金</span> <span class="o">=</span> 每口原始保證金(<span class="n">${fM(im,cur)}</span>) <span class="o">×</span> 口數(<span class="n">${qty}</span>) <span class="o">=</span> <span class="r">${fM(tIM,cur)}</span></span>
      <span class="fl"><span class="v">所需維持保證金</span> <span class="o">=</span> 每口維持保證金(<span class="n">${fM(mm,cur)}</span>) <span class="o">×</span> 口數(<span class="n">${qty}</span>) <span class="o">=</span> <span class="r">${fM(tMM,cur)}</span></span>
      <span class="fl"><span class="v">初始權益數(帳戶餘額)</span> <span class="o">=</span> <span class="r">${fM(initEq,cur)}</span></span>
      <span class="fl"><span class="v">超額保證金</span> <span class="o">=</span> 初始權益(<span class="n">${fM(initEq,cur)}</span>) <span class="o">−</span> 原始保證金(<span class="n">${fM(tIM,cur)}</span>) <span class="o">=</span> <span class="${excessMargin >= 0 ? 'r' : 'n'}">${fM(excessMargin,cur)}</span></span>
      <div class="fn">入金 > 原始保證金 → 有額外緩衝空間，追繳/砍倉距離更遠<br>入金 = 原始保證金 → 剛好達最低要求，無額外緩衝</div>
    </div>
    <div class="fb"><h4>2. 每點損益</h4>
      <span class="fl"><span class="v">每點損益</span> <span class="o">=</span> 每點價值(<span class="n">${fM(mul,cur)}</span>) <span class="o">×</span> 口數(<span class="n">${qty}</span>) <span class="o">=</span> <span class="r">${fM(ppm,cur)}</span></span>
      <div class="fn">${long ? '做多' : '做空'}：指數每${long ? '漲' : '跌'}1點，獲利 ${fM(ppm,cur)}；每${long ? '跌' : '漲'}1點，虧損 ${fM(ppm,cur)}</div>
    </div>
    <div class="fb"><h4>3. 未實現損益 & 權益數</h4>
      <span class="fl"><span class="v">點數差</span> <span class="o">=</span> ${long ? '目前點數' : '進場點數'}(<span class="n">${long ? fmt(curr,2) : fmt(entry,2)}</span>) <span class="o">−</span> ${long ? '進場點數' : '目前點數'}(<span class="n">${long ? fmt(entry,2) : fmt(curr,2)}</span>) <span class="o">=</span> <span class="r">${fmt(pd,2)} ${u}</span></span>
      <span class="fl"><span class="v">未實現損益</span> <span class="o">=</span> 點數差(<span class="n">${fmt(pd,2)}</span>) <span class="o">×</span> 每點損益(<span class="n">${fM(ppm,cur)}</span>) <span class="o">=</span> <span class="r">${plS}${fM(upl,cur)}</span></span>
      <span class="fl"><span class="v">目前權益數</span> <span class="o">=</span> 初始權益(<span class="n">${fM(initEq,cur)}</span>) <span class="o">+</span> 損益(<span class="n">${plS}${fM(upl,cur)}</span>) <span class="o">=</span> <span class="r">${fM(eq,cur)}</span></span>
    </div>
    <div class="fb"><h4>4. 風險指標</h4>
      <span class="fl"><span class="v">風險指標</span> <span class="o">=</span> 權益數(<span class="n">${fM(eq,cur)}</span>) <span class="o">÷</span> 原始保證金(<span class="n">${fM(tIM,cur)}</span>) <span class="o">=</span> <span class="r">${fP(ri)}</span></span>
      <div class="fn">權益數(<span>${fM(eq,cur)}</span>) < 維持保證金(<span>${fM(tMM,cur)}</span>) → 追繳 (需補繳至原始保證金 ${fM(tIM,cur)})<br>風險指標 ≤ 25% → 期貨商可強制砍倉</div>
    </div>
    <div class="fb"><h4>5. 追繳 & 砍倉點位</h4>
      <span class="fl"><span class="v">可承受虧損(至追繳)</span> <span class="o">=</span> 初始權益(<span class="n">${fM(initEq,cur)}</span>) <span class="o">−</span> 維持保證金(<span class="n">${fM(tMM,cur)}</span>) <span class="o">=</span> <span class="r">${fM(maxLossToCall,cur)}</span></span>
      <span class="fl"><span class="v">追繳點數</span> <span class="o">=</span> 可承受虧損(<span class="n">${fM(maxLossToCall,cur)}</span>) <span class="o">÷</span> 每點損益(<span class="n">${fM(ppm,cur)}</span>) <span class="o">=</span> <span class="r">${fmt(ptToCall,2)} ${u}</span></span>
      <span class="fl"><span class="v">追繳點位</span> <span class="o">=</span> 進場(<span class="n">${fmt(entry,2)}</span>) ${long ? '−' : '+'} 追繳點數(<span class="n">${fmt(ptToCall,2)}</span>) <span class="o">=</span> <span class="r">${fmt(callLvl,2)} ${u}</span>　距目前 <span class="r">${fmt(dC,2)} ${u}</span></span>
      <span class="fl"><span class="v">可承受虧損(至砍倉)</span> <span class="o">=</span> 初始權益(<span class="n">${fM(initEq,cur)}</span>) <span class="o">−</span> 25%×原始保證金(<span class="n">${fM(0.25*tIM,cur)}</span>) <span class="o">=</span> <span class="r">${fM(maxLossToForced,cur)}</span></span>
      <span class="fl"><span class="v">砍倉點位</span> <span class="o">=</span> <span class="r">${fmt(forcedLvl,2)} ${u}</span>　距目前 <span class="r">${fmt(dF,2)} ${u}</span></span>
    </div>
    <div class="fb"><h4>6. 期貨商處置流程</h4>
      <span class="fl">① <span class="v">權益數 < 維持保證金 (${fM(tMM,cur)})</span>：期貨商於盤後發出<strong>追繳通知</strong>，交易人須在<strong>次一營業日中午 12:00 前</strong>補繳至原始保證金水位 (${fM(tIM,cur)})。</span>
      <span class="fl">② <span class="v">逾期未補繳</span>：期貨商有權自<strong>次一營業日起</strong>，以市價<strong>代為沖銷</strong>（強制平倉）部分或全部部位，直至權益數回到原始保證金以上。</span>
      <span class="fl">③ <span class="v">風險指標 ≤ 25%</span>：期貨商可<strong>不另通知</strong>，立即執行代為沖銷（俗稱「砍倉」）。盤中若指標急跌至此水位，可能<strong>盤中即時砍倉</strong>。</span>
      <span class="fl">④ <span class="v">結算日</span>：到期月份合約會在<strong>最後結算日</strong>以結算價強制平倉（現金結算）或進行實物交割。</span>
      <div class="fn">實際追繳時限與砍倉門檻以各期貨商風控規則為準。上述為台灣期交所一般慣例；海外期貨規則類似但時限可能不同。</div>
    </div>
  </div>`;

  $('#futures-results').innerHTML = subTabs('fr', ['風險概覽', '壓力測試', '計算公式'], [overview, stress, formula]);
}

// ================================================================
//  OPTIONS FORM
// ================================================================
function renderOptionsForm() {
  const { market, side } = S.options;
  const tw = market === 'tw', buyer = side === 'buyer';
  const cur = tw ? 'NT$' : 'USD', defMul = tw ? 50 : 100;

  let h = `
    <div class="fg"><label>類型</label><select id="o-type"><option value="call">Call 買權</option><option value="put">Put 賣權</option></select></div>
    <div class="fr">
      <div class="fg"><label>標的物${tw ? '指數' : '價格'}</label><input type="number" id="o-ul" placeholder="${tw ? '20000' : '500'}" step="any">
        <div style="display:flex;gap:3px;margin-top:2px;flex-wrap:wrap"><button type="button" class="ticker-fill-btn" onclick="fillOptFromTicker()">行情帶入</button><button type="button" class="ticker-fill-btn" onclick="fetchOptPrice()">API查詢</button></div>
      </div>
      <div class="fg"><label>履約價 Strike</label><input type="number" id="o-strike" placeholder="${tw ? '20000' : '500'}" step="any"></div>
    </div>
    <div class="fr">
      <div class="fg"><label>權利金 <span class="hint">(每點)</span></label><input type="number" id="o-premium" placeholder="${tw ? '300' : '5'}" step="any"></div>
      <div class="fg"><label>到期結算價 <span class="hint">(選填)</span></label><input type="number" id="o-exp" placeholder="結算價" step="any"></div>
    </div>
    <div class="fr">
      <div class="fg"><label>口數</label><input type="number" id="o-qty" value="1" min="1" step="1"></div>
      <div class="fg"><label>乘數 <span class="hint">(${cur}/點)</span></label><input type="number" id="o-mul" value="${defMul}" step="any"></div>
    </div>`;

  if (!buyer) {
    h += `<div class="fr">
      <div class="fg"><label>風險保證金比率</label><div class="isuf"><input type="number" id="o-rr" value="15" step="any"><span class="suf">%</span></div></div>
      <div class="fg"><label>最低保證金比率</label><div class="isuf"><input type="number" id="o-mr" value="10" step="any"><span class="suf">%</span></div></div>
    </div>`;
  }

  h += `<div class="fr">
    <div class="fg"><label>手續費 <span class="hint">(${cur}/口·單邊)</span></label><input type="number" id="o-comm" value="${tw ? '25' : '0.65'}" step="any"></div>
    <div class="fg"><label>交易稅率</label><select id="o-tax-rate">
      ${tw ? `<option value="0.001" selected>千分之一</option><option value="0">免稅</option>` : `<option value="0" selected>無</option>`}
    </select></div>
  </div>`;

  $('#options-inputs').innerHTML = h;
  $('#options-results').innerHTML = PLACEHOLDER;

  wrapNumberInputs($('#options-inputs'));
}

window.fetchOptPrice = async function() {
  const idxKey = S.options.market === 'tw' ? 'taiex' : 'sp500';
  const el = document.getElementById('o-ul');
  if (!el) return;
  el.placeholder = '查詢中…';
  try {
    const q = await PriceService.fetchIndex(idxKey);
    el.value = q.price.toFixed(2);
    el.placeholder = S.options.market === 'tw' ? '20000' : '500';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    el.placeholder = '查詢失敗';
    setTimeout(() => { el.placeholder = S.options.market === 'tw' ? '20000' : '500'; }, 2000);
  }
};

window.fillOptFromTicker = function() {
  const id = S.options.market === 'tw' ? 'idx-taiex' : 'idx-sp500';
  const v = gV(id);
  if (v) { document.getElementById('o-ul').value = v; document.getElementById('o-ul').dispatchEvent(new Event('input', { bubbles: true })); }
};

// ================================================================
//  OPTIONS CALC
// ================================================================
function calcOptions() {
  const { market, side } = S.options;
  const tw = market === 'tw', buyer = side === 'buyer', cur = tw ? 'NT$' : 'USD';
  const isCall = $('#o-type')?.value === 'call';
  const ul = gV('o-ul'), strike = gV('o-strike'), prem = gV('o-premium');
  const qty = gV('o-qty'), mul = gV('o-mul');
  if (!ul || !strike || !prem || !qty || !mul) { $('#options-results').innerHTML = PLACEHOLDER; return; }

  // Fee calculation
  const oComm = gV('o-comm') || 0;
  const oTaxRate = parseFloat($('#o-tax-rate')?.value || '0');
  const oCommTotal = oComm * qty * 2; // open + close
  const oOpenTax = prem * mul * qty * oTaxRate; // tax on premium at open
  const oCloseTax = prem * mul * qty * oTaxRate; // approximate (close at same premium)
  const oFees = oCommTotal + oOpenTax + oCloseTax;

  const totalPrem = prem * mul * qty;
  const iv = isCall ? Math.max(0, ul - strike) : Math.max(0, strike - ul);
  const tv = Math.max(0, prem - iv);
  const oom = isCall ? Math.max(0, strike - ul) : Math.max(0, ul - strike);
  const money = isCall ? (ul > strike ? '價內 ITM' : ul === strike ? '價平 ATM' : '價外 OTM')
    : (ul < strike ? '價內 ITM' : ul === strike ? '價平 ATM' : '價外 OTM');
  const be = isCall ? strike + prem : strike - prem;

  let expPL = null;
  const expP = gV('o-exp');
  if (expP) {
    const eIv = isCall ? Math.max(0, expP - strike) : Math.max(0, strike - expP);
    expPL = buyer ? (eIv - prem) * mul * qty : (prem - eIv) * mul * qty;
  }

  if (buyer) {
    const overview = `
      ${alertBox('safe', '買方風險有限，最大虧損 = 權利金。不會追繳或斷頭。')}
      <div class="mg">
        ${mc(`${isCall ? 'Call' : 'Put'} 買方`, money, `履約價 ${fmt(strike)} | ${qty}口`, 'h-accent')}
        ${mc('最大虧損 = 權利金+費用', fM(totalPrem + oFees, cur), `權利金 ${fM(totalPrem, cur)} + 費用 ${fM(oFees, cur)}`, 'h-red')}
        ${oFees > 0 ? mc('交易成本', fM(oFees, cur), `手續費 ${fM(oCommTotal, cur)} / ${tw ? '交易稅' : 'Tax'} ${fM(oOpenTax + oCloseTax, cur)}`, 'h-yellow') : ''}
        ${mc('損益平衡', fmt(be, 2), isCall ? '履約價 + 權利金' : '履約價 - 權利金')}
        ${mc('內含價值 / 時間價值', fmt(iv, 2) + ' / ' + fmt(tv, 2))}
        ${mc('最大獲利', isCall ? '無上限' : fM((strike - prem) * mul * qty, cur))}
        ${expPL !== null ? mc('到期損益(税前)', (expPL >= 0 ? '+' : '') + fM(expPL, cur), `結算價 ${fmt(expP)} | 報酬率 ${(expPL / totalPrem * 100).toFixed(1)}%`, expPL >= 0 ? 'h-green' : 'h-red') : ''}
        ${expPL !== null && oFees > 0 ? mc('到期淨損益(税後)', ((expPL - oFees) >= 0 ? '+' : '') + fM(expPL - oFees, cur), `扣除費用 ${fM(oFees, cur)}`, (expPL - oFees) >= 0 ? 'h-green' : 'h-red') : ''}
      </div>`;
    const stress = buildOptionsStress(isCall, buyer, prem, strike, mul, qty, ul, cur);
    const formula = `<div class="fc">
      <div class="fb"><h4>1. 權利金成本</h4>
        <span class="fl"><span class="v">總成本</span> <span class="o">=</span> 權利金(<span class="n">${fmt(prem,2)}</span>) <span class="o">×</span> 乘數(<span class="n">${fmt(mul)}</span>) <span class="o">×</span> 口數(<span class="n">${qty}</span>) <span class="o">=</span> <span class="r">${fM(totalPrem,cur)}</span></span>
        <div class="fn">買方最大虧損 = 全部權利金 ${fM(totalPrem,cur)}，不需保證金，不會追繳。</div>
      </div>
      <div class="fb"><h4>2. 價值分析</h4>
        <span class="fl"><span class="v">內含價值</span> <span class="o">=</span> ${isCall ? `Max(0, 標的(${fmt(ul,2)}) − 履約價(${fmt(strike,2)}))` : `Max(0, 履約價(${fmt(strike,2)}) − 標的(${fmt(ul,2)}))`} <span class="o">=</span> <span class="r">${fmt(iv,2)}</span></span>
        <span class="fl"><span class="v">時間價值</span> <span class="o">=</span> 權利金(<span class="n">${fmt(prem,2)}</span>) <span class="o">−</span> 內含價值(<span class="n">${fmt(iv,2)}</span>) <span class="o">=</span> <span class="r">${fmt(tv,2)}</span></span>
        <span class="fl"><span class="v">價內外狀態</span> <span class="o">=</span> <span class="r">${money}</span>${oom > 0 ? `　價外值 = <span class="n">${fmt(oom,2)}</span>` : ''}</span>
      </div>
      <div class="fb"><h4>3. 損益平衡</h4>
        <span class="fl"><span class="v">損益平衡點</span> <span class="o">=</span> ${isCall ? `履約價(${fmt(strike,2)}) + 權利金(${fmt(prem,2)})` : `履約價(${fmt(strike,2)}) − 權利金(${fmt(prem,2)})`} <span class="o">=</span> <span class="r">${fmt(be,2)}</span></span>
        <div class="fn">${isCall ? '標的高於' : '標的低於'} ${fmt(be,2)} 才開始獲利</div>
      </div>
      ${expPL !== null ? `<div class="fb"><h4>4. 到期損益試算</h4>
        <span class="fl"><span class="v">到期內含價值</span> <span class="o">=</span> ${isCall ? `Max(0, 結算價(${fmt(expP,2)}) − 履約價(${fmt(strike,2)}))` : `Max(0, 履約價(${fmt(strike,2)}) − 結算價(${fmt(expP,2)}))`} <span class="o">=</span> <span class="r">${fmt(isCall ? Math.max(0,expP-strike) : Math.max(0,strike-expP),2)}</span></span>
        <span class="fl"><span class="v">到期損益</span> <span class="o">=</span> (到期內含值(<span class="n">${fmt(isCall ? Math.max(0,expP-strike) : Math.max(0,strike-expP),2)}</span>) <span class="o">−</span> 權利金(<span class="n">${fmt(prem,2)}</span>)) <span class="o">×</span> 乘數(<span class="n">${fmt(mul)}</span>) <span class="o">×</span> 口數(<span class="n">${qty}</span>) <span class="o">=</span> <span class="r">${(expPL>=0?'+':'')}${fM(expPL,cur)}</span></span>
        <span class="fl"><span class="v">報酬率</span> <span class="o">=</span> 損益(<span class="n">${(expPL>=0?'+':'')}${fM(expPL,cur)}</span>) <span class="o">÷</span> 成本(<span class="n">${fM(totalPrem,cur)}</span>) <span class="o">=</span> <span class="r">${(expPL/totalPrem*100).toFixed(1)}%</span></span>
      </div>` : ''}
      <div class="fb"><h4>${expPL !== null ? '5' : '4'}. 買方風險說明</h4>
        <span class="fl">① <span class="v">不需保證金、不會追繳</span>：買方已在進場時支付全部權利金 ${fM(totalPrem,cur)}，此即為<strong>最大虧損上限</strong>，無論市場如何波動都不會被追繳。</span>
        <span class="fl">② <span class="v">到期處理</span>：到期時若為<strong>價內</strong>（有內含價值），台灣期交所會<strong>自動現金結算</strong>；若為<strong>價外</strong>，權利金歸零、合約自動消滅。</span>
        <span class="fl">③ <span class="v">時間價值衰減</span>：距到期越近，時間價值(${fmt(tv,2)})衰減越快（Theta 效應），即使標的不動，權利金也會下降。</span>
        <div class="fn">買方風險有限但獲利機率較低，統計上大多數選擇權到期時為價外（歸零）。</div>
      </div>
    </div>`;
    $('#options-results').innerHTML = subTabs('or', ['風險概覽', '到期情境', '計算公式'], [overview, stress, formula]);
  } else {
    const rr = gV('o-rr') / 100, mr = gV('o-mr') / 100;
    const pmv = prem * mul, uv = ul * mul;
    const A = uv * rr - oom * mul, B = uv * mr;
    const mpc = Math.max(A, B) + pmv, totalMargin = mpc * qty;

    const overview = `
      ${alertBox('danger', `賣方風險${isCall ? '無上限' : '極大'}！需繳交保證金，可能被追繳。`)}
      <div class="mg">
        ${mc(`${isCall ? 'Call' : 'Put'} 賣方`, money, `履約價 ${fmt(strike)} | ${qty}口`, 'h-red')}
        ${mc('所需保證金', fM(totalMargin, cur), `每口 ${fM(mpc, cur)}`, 'h-yellow')}
        ${mc('最大獲利(税前)', fM(totalPrem, cur), '', 'h-green')}
        ${oFees > 0 ? mc('交易成本', fM(oFees, cur), `手續費 ${fM(oCommTotal, cur)} / ${tw ? '交易稅' : 'Tax'} ${fM(oOpenTax + oCloseTax, cur)}`, 'h-yellow') : ''}
        ${oFees > 0 ? mc('最大淨獲利(税後)', fM(totalPrem - oFees, cur), '', 'h-green') : ''}
        ${mc('最大虧損', isCall ? '無上限' : fM((strike - prem) * mul * qty, cur), '', 'h-red')}
        ${mc('損益平衡', fmt(be, 2))}
        ${mc('價外值', fmt(oom, 2), `A=${fM(A, cur)} B=${fM(B, cur)}`)}
        ${expPL !== null ? mc('到期損益(税前)', (expPL >= 0 ? '+' : '') + fM(expPL, cur), `結算價 ${fmt(expP)}`, expPL >= 0 ? 'h-green' : 'h-red') : ''}
        ${expPL !== null && oFees > 0 ? mc('到期淨損益(税後)', ((expPL - oFees) >= 0 ? '+' : '') + fM(expPL - oFees, cur), '', (expPL - oFees) >= 0 ? 'h-green' : 'h-red') : ''}
      </div>`;
    const stress = buildOptionsStress(isCall, buyer, prem, strike, mul, qty, ul, cur);
    const maxLoss = isCall ? '無上限' : fM((strike - prem) * mul * qty, cur);
    const formula = `<div class="fc">
      <div class="fb"><h4>1. 權利金收入</h4>
        <span class="fl"><span class="v">每口收入</span> <span class="o">=</span> 權利金(<span class="n">${fmt(prem,2)}</span>) <span class="o">×</span> 乘數(<span class="n">${fmt(mul)}</span>) <span class="o">=</span> <span class="r">${fM(pmv,cur)}</span></span>
        <span class="fl"><span class="v">總收入</span> <span class="o">=</span> 每口收入(<span class="n">${fM(pmv,cur)}</span>) <span class="o">×</span> 口數(<span class="n">${qty}</span>) <span class="o">=</span> <span class="r">${fM(totalPrem,cur)}</span></span>
        <div class="fn">賣方最大獲利 = 全部權利金 ${fM(totalPrem,cur)}（買方不履約時）</div>
      </div>
      <div class="fb"><h4>2. 保證金計算</h4>
        <span class="fl"><span class="v">標的價值</span> <span class="o">=</span> 標的物(<span class="n">${fmt(ul,2)}</span>) <span class="o">×</span> 乘數(<span class="n">${fmt(mul)}</span>) <span class="o">=</span> <span class="r">${fM(uv,cur)}</span></span>
        <span class="fl"><span class="v">價外值</span> <span class="o">=</span> ${isCall ? `Max(0, 履約價(${fmt(strike,2)}) − 標的(${fmt(ul,2)}))` : `Max(0, 標的(${fmt(ul,2)}) − 履約價(${fmt(strike,2)}))`} <span class="o">=</span> <span class="r">${fmt(oom,2)}</span></span>
        <span class="fl"><span class="v">A</span> <span class="o">=</span> 標的價值(<span class="n">${fM(uv,cur)}</span>) <span class="o">×</span> 風險比率(<span class="n">${(rr*100).toFixed(0)}%</span>) <span class="o">−</span> 價外值(<span class="n">${fmt(oom,2)}</span>) <span class="o">×</span> 乘數(<span class="n">${fmt(mul)}</span>) <span class="o">=</span> <span class="r">${fM(A,cur)}</span></span>
        <span class="fl"><span class="v">B</span> <span class="o">=</span> 標的價值(<span class="n">${fM(uv,cur)}</span>) <span class="o">×</span> 最低比率(<span class="n">${(mr*100).toFixed(0)}%</span>) <span class="o">=</span> <span class="r">${fM(B,cur)}</span></span>
        <span class="fl"><span class="v">每口保證金</span> <span class="o">=</span> Max(A(<span class="n">${fM(A,cur)}</span>), B(<span class="n">${fM(B,cur)}</span>)) <span class="o">+</span> 權利金市值(<span class="n">${fM(pmv,cur)}</span>) <span class="o">=</span> <span class="r">${fM(mpc,cur)}</span></span>
        <span class="fl"><span class="v">總保證金</span> <span class="o">=</span> 每口(<span class="n">${fM(mpc,cur)}</span>) <span class="o">×</span> 口數(<span class="n">${qty}</span>) <span class="o">=</span> <span class="r">${fM(totalMargin,cur)}</span></span>
        <div class="fn">實際保證金可能使用 SPAN 模型，以上為簡化公式。</div>
      </div>
      <div class="fb"><h4>3. 價值分析</h4>
        <span class="fl"><span class="v">內含價值</span> <span class="o">=</span> ${isCall ? `Max(0, 標的(${fmt(ul,2)}) − 履約價(${fmt(strike,2)}))` : `Max(0, 履約價(${fmt(strike,2)}) − 標的(${fmt(ul,2)}))`} <span class="o">=</span> <span class="r">${fmt(iv,2)}</span></span>
        <span class="fl"><span class="v">時間價值</span> <span class="o">=</span> 權利金(<span class="n">${fmt(prem,2)}</span>) <span class="o">−</span> 內含價值(<span class="n">${fmt(iv,2)}</span>) <span class="o">=</span> <span class="r">${fmt(tv,2)}</span></span>
        <span class="fl"><span class="v">價內外狀態</span> <span class="o">=</span> <span class="r">${money}</span>${oom > 0 ? `　價外值 = <span class="n">${fmt(oom,2)}</span>（賣方有利）` : ''}</span>
      </div>
      <div class="fb"><h4>4. 損益平衡與風險</h4>
        <span class="fl"><span class="v">損益平衡點</span> <span class="o">=</span> ${isCall ? `履約價(${fmt(strike,2)}) + 權利金(${fmt(prem,2)})` : `履約價(${fmt(strike,2)}) − 權利金(${fmt(prem,2)})`} <span class="o">=</span> <span class="r">${fmt(be,2)}</span></span>
        <span class="fl"><span class="v">最大獲利</span> <span class="o">=</span> 全部權利金 <span class="o">=</span> <span class="r">${fM(totalPrem,cur)}</span></span>
        <span class="fl"><span class="v">最大虧損</span> <span class="o">=</span> <span class="r">${maxLoss}</span></span>
        <div class="fn">${isCall ? '標的超過' : '標的低於'} ${fmt(be,2)} 時開始虧損，賣方風險${isCall ? '無上限' : '極大'}！</div>
      </div>
      ${expPL !== null ? `<div class="fb"><h4>5. 到期損益試算</h4>
        <span class="fl"><span class="v">到期內含價值</span> <span class="o">=</span> ${isCall ? `Max(0, 結算價(${fmt(expP,2)}) − 履約價(${fmt(strike,2)}))` : `Max(0, 履約價(${fmt(strike,2)}) − 結算價(${fmt(expP,2)}))`} <span class="o">=</span> <span class="r">${fmt(isCall ? Math.max(0,expP-strike) : Math.max(0,strike-expP),2)}</span></span>
        <span class="fl"><span class="v">到期損益</span> <span class="o">=</span> (權利金(<span class="n">${fmt(prem,2)}</span>) <span class="o">−</span> 到期內含值(<span class="n">${fmt(isCall ? Math.max(0,expP-strike) : Math.max(0,strike-expP),2)}</span>)) <span class="o">×</span> 乘數(<span class="n">${fmt(mul)}</span>) <span class="o">×</span> 口數(<span class="n">${qty}</span>) <span class="o">=</span> <span class="r">${(expPL>=0?'+':'')}${fM(expPL,cur)}</span></span>
        <span class="fl"><span class="v">報酬率(對保證金)</span> <span class="o">=</span> 損益(<span class="n">${(expPL>=0?'+':'')}${fM(expPL,cur)}</span>) <span class="o">÷</span> 保證金(<span class="n">${fM(totalMargin,cur)}</span>) <span class="o">=</span> <span class="r">${(expPL/totalMargin*100).toFixed(1)}%</span></span>
      </div>` : ''}
      <div class="fb"><h4>${expPL !== null ? '6' : '5'}. 期貨商處置流程（賣方）</h4>
        <span class="fl">① <span class="v">保證金不足</span>：當市場不利變動導致帳戶權益低於<strong>維持保證金</strong>時，期貨商盤後發出<strong>追繳通知</strong>，須在<strong>次一營業日中午 12:00 前</strong>補繳至原始保證金水位。</span>
        <span class="fl">② <span class="v">逾期未補繳</span>：期貨商可<strong>代為沖銷</strong>（強制平倉）賣方部位。</span>
        <span class="fl">③ <span class="v">風險指標 ≤ 25%</span>：期貨商可<strong>不另通知、立即砍倉</strong>，盤中即時執行。</span>
        <span class="fl">④ <span class="v">到期結算</span>：到期時若為<strong>價內</strong>，賣方需支付內含價值差額（自動現金結算）；若為<strong>價外</strong>，賣方保留全部權利金。</span>
        <span class="fl">⑤ <span class="v">賣方特有風險</span>：${isCall ? 'Call 賣方虧損理論上<strong>無上限</strong>（標的可無限上漲）' : 'Put 賣方虧損可達 ' + fM((strike-prem)*mul*qty, cur) + '（標的跌至0）'}，且保證金會隨市場波動而<strong>動態調整</strong>（SPAN 模型），可能需要額外補繳。</span>
        <div class="fn">實際追繳時限與砍倉門檻以各期貨商風控規則為準。賣方風險極大，請務必做好資金管理。</div>
      </div>
    </div>`;
    $('#options-results').innerHTML = subTabs('or', ['風險概覽', '到期情境', '計算公式'], [overview, stress, formula]);
  }
}

function buildOptionsStress(isCall, buyer, prem, strike, mul, qty, ul, cur) {
  const range = ul * 0.15, step = Math.max(1, Math.round(range / 10));
  const levels = [];
  for (let p = ul - range; p <= ul + range; p += step) levels.push(Math.round(p));
  if (!levels.includes(Math.round(strike))) levels.push(Math.round(strike));
  if (!levels.includes(Math.round(ul))) levels.push(Math.round(ul));
  levels.sort((a, b) => a - b);
  let rows = '';
  for (const lv of levels) {
    const iv2 = isCall ? Math.max(0, lv - strike) : Math.max(0, strike - lv);
    const pl = buyer ? (iv2 - prem) * mul * qty : (prem - iv2) * mul * qty;
    const rc = lv === Math.round(ul) ? 'rc' : '', isSt = lv === Math.round(strike);
    const sc = pl >= 0 ? 'sb-s' : 'sb-x';
    rows += `<tr class="${rc}"><td>${fmt(lv)}${isSt ? ' (履約)' : ''}${lv === Math.round(ul) ? ' (目前)' : ''}</td><td>${fmt(iv2, 2)}</td><td class="${pl >= 0 ? 'tg' : 'tr'}">${pl >= 0 ? '+' : ''}${fM(pl, cur)}</td><td><span class="sb ${sc}">${pl >= 0 ? '獲利' : '虧損'}</span></td></tr>`;
  }
  return `<div class="st-wrap"><table class="st"><thead><tr><th>結算價</th><th>內含價值</th><th>損益</th><th>狀態</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
