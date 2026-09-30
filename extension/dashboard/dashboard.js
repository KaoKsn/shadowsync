/**
 * PrivSight Analytics Dashboard (dashboard.js)
 *
 * Reads 'privsight-history' from chrome.storage.local (written by the side
 * panel when a session completes) and renders, for the selected time range:
 *  - KPI tiles (items redacted with period-over-period change, sessions,
 *    sites, most-caught category)
 *  - Stacked bar chart of redactions over time, by category, with tooltips
 *  - Category share + per-type drill-down
 *  - Top sites (click to filter the history table)
 *  - Session history: search, sort, pagination, expandable detail, delete
 *  - CSV export, clear-all with undo, light/dark theme, live updates
 *
 * Session record fields: id, timestamp, domain, prompt, dataFound,
 * sensitiveRecognized, sensitiveRemoved, protectionRate, and (newer
 * sessions) breakdown {<redactor stat key>: count}, steps, durationMs.
 * Older records without a breakdown are shown as "Unclassified".
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'privsight-history';
  const PREF_RANGE  = 'privsight-dashboard-range';
  const PREF_THEME  = 'privsight-dashboard-theme';
  const PAGE_SIZE   = 10;
  const DAY         = 86400000;

  // ── Categories ────────────────────────────────────────────────
  // Keys under `types` match the stats keys produced by content/redactor.js
  // (plus the legacy keys the old dashboard expected). Order = stack order.
  const CATEGORIES = [
    { key: 'identity',    label: 'Identity documents', color: 'var(--c-identity)',
      types: ['profile', 'aadhaar', 'pan', 'indianPassport', 'ssn', 'vehicleRegistration'] },
    { key: 'financial',   label: 'Financial',          color: 'var(--c-financial)',
      types: ['creditCard', 'ifsc'] },
    { key: 'contact',     label: 'Contact details',    color: 'var(--c-contact)',
      types: ['email', 'phone'] },
    { key: 'credentials', label: 'Credentials & keys', color: 'var(--c-credentials)',
      types: ['password', 'apiKey', 'jwt', 'bearer', 'username'] },
    { key: 'names',       label: 'Names & entities',   color: 'var(--c-names)',
      types: ['entity'] },
    { key: 'other',       label: 'Other / unclassified', color: 'var(--c-other)',
      types: ['other', 'unclassified'] },
  ];

  const TYPE_LABELS = {
    profile: 'Your saved profile values',
    aadhaar: 'Aadhaar numbers',
    pan: 'PAN numbers',
    indianPassport: 'Passport numbers',
    ssn: 'SSN / national IDs',
    vehicleRegistration: 'Vehicle registrations',
    creditCard: 'Card numbers',
    ifsc: 'IFSC codes',
    email: 'Email addresses',
    phone: 'Phone numbers',
    password: 'Passwords',
    apiKey: 'API keys',
    jwt: 'JWT tokens',
    bearer: 'Bearer tokens',
    username: 'Usernames',
    entity: 'Names, orgs & places',
    other: 'Other',
    unclassified: 'Recorded before type tracking',
  };

  const CAT_BY_KEY  = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
  const TYPE_TO_CAT = {};
  CATEGORIES.forEach((c) => c.types.forEach((t) => { TYPE_TO_CAT[t] = c.key; }));

  // ── DOM ───────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    range: $('db-range'),
    themeBtn: $('db-theme-btn'),
    exportBtn: $('db-export-btn'),
    heroSub: $('db-hero-sub'),
    lastUpdated: $('db-last-updated'),
    kpiRedacted: $('kpi-redacted'),
    kpiRedactedFoot: $('kpi-redacted-foot'),
    kpiSessions: $('kpi-sessions'),
    kpiSessionsFoot: $('kpi-sessions-foot'),
    kpiSites: $('kpi-sites'),
    kpiSitesFoot: $('kpi-sites-foot'),
    kpiTop: $('kpi-top'),
    kpiTopFoot: $('kpi-top-foot'),
    empty: $('db-empty'),
    grid: $('db-grid'),
    chart: $('db-chart'),
    chartSub: $('db-chart-sub'),
    tip: $('db-tip'),
    legend: $('db-legend'),
    share: $('db-share'),
    cats: $('db-cats'),
    catsNote: $('db-cats-note'),
    sites: $('db-sites'),
    historySub: $('db-history-sub'),
    search: $('db-search'),
    clearBtn: $('db-clear-btn'),
    filterChip: $('db-filter-chip'),
    filterSite: $('db-filter-site'),
    filterClear: $('db-filter-clear'),
    tableBody: $('db-table-body'),
    tableEmpty: $('db-table-empty'),
    pager: $('db-pager'),
    pagerInfo: $('db-pager-info'),
    prev: $('db-prev'),
    next: $('db-next'),
    toast: $('db-toast'),
    toastMsg: $('db-toast-msg'),
    toastUndo: $('db-toast-undo'),
    modalOverlay: $('db-modal-overlay'),
    modalCount: $('db-modal-count'),
    modalCancel: $('db-modal-cancel'),
    modalConfirm: $('db-modal-confirm'),
  };

  // ── State ─────────────────────────────────────────────────────
  let raw = [];          // records exactly as stored
  let sessions = [];     // normalized, newest first
  const state = {
    range: ['7', '30', 'all'].includes(readPref(PREF_RANGE, 'all')) ? readPref(PREF_RANGE, 'all') : 'all',
    site: null,
    query: '',
    sort: { key: 'time', dir: 'desc' },
    page: 0,
    openRows: new Set(),
    openCats: new Set(),
  };
  let inRange = [];      // sessions in the current range
  let undoAction = null;
  let toastTimer = null;
  let modalReturnFocus = null;

  // ══════════════════════════════════════════════════════════════
  // STORAGE & PREFS
  // ══════════════════════════════════════════════════════════════
  function loadHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
        resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
      });
    });
  }

  function saveHistory(list) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: list }, resolve);
    });
  }

  function readPref(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  }

  function writePref(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  }

  // ══════════════════════════════════════════════════════════════
  // NORMALIZATION
  // ══════════════════════════════════════════════════════════════
  function recordKey(r) {
    return `${r.id ?? ''}|${r.timestamp ?? ''}`;
  }

  function normalize(r) {
    const ts = Date.parse(r.timestamp) || Number(r.id) || 0;
    const items = Number(r.sensitiveRecognized ?? r.dataFound ?? 0) || 0;

    // Per-type counts; anything not accounted for is "unclassified"
    const types = {};
    let typed = 0;
    if (r.breakdown && typeof r.breakdown === 'object') {
      Object.entries(r.breakdown).forEach(([k, v]) => {
        const n = Number(v) || 0;
        if (n <= 0) return;
        const key = TYPE_TO_CAT[k] ? k : 'other';
        types[key] = (types[key] || 0) + n;
        typed += n;
      });
    }
    if (items > typed) types.unclassified = items - typed;

    const cats = {};
    Object.entries(types).forEach(([t, n]) => {
      const c = TYPE_TO_CAT[t] || 'other';
      cats[c] = (cats[c] || 0) + n;
    });

    return {
      key: recordKey(r),
      ts,
      domain: String(r.domain || 'Unknown'),
      prompt: String(r.prompt || ''),
      items: Math.max(items, typed),
      types,
      cats,
      hasBreakdown: typed > 0 || (items === 0 && !!r.breakdown),
      steps: Number.isFinite(r.steps) ? r.steps : null,
      durationMs: Number.isFinite(r.durationMs) ? r.durationMs : null,
    };
  }

  function setHistory(list) {
    raw = list;
    sessions = list.map(normalize).sort((a, b) => b.ts - a.ts);
    // Drop UI state that points at sessions that no longer exist
    const keys = new Set(sessions.map((s) => s.key));
    state.openRows.forEach((k) => { if (!keys.has(k)) state.openRows.delete(k); });
  }

  // ══════════════════════════════════════════════════════════════
  // RANGE MATH
  // ══════════════════════════════════════════════════════════════
  function startOfDay(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function rangeBounds(range) {
    if (range === 'all') return null;
    const days = Number(range);
    const end = startOfDay(Date.now()) + DAY;
    const start = end - days * DAY;
    return { start, end, prevStart: start - days * DAY, days };
  }

  function sumItems(list) {
    return list.reduce((s, x) => s + x.items, 0);
  }

  function aggregate(list) {
    const cats = {};
    const types = {};
    list.forEach((s) => {
      Object.entries(s.cats).forEach(([k, v]) => { cats[k] = (cats[k] || 0) + v; });
      Object.entries(s.types).forEach(([k, v]) => { types[k] = (types[k] || 0) + v; });
    });
    return { cats, types, total: sumItems(list) };
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — ENTRY
  // ══════════════════════════════════════════════════════════════
  function renderAll() {
    const b = rangeBounds(state.range);
    inRange = b ? sessions.filter((s) => s.ts >= b.start && s.ts < b.end) : sessions;
    const prev = b ? sessions.filter((s) => s.ts >= b.prevStart && s.ts < b.start) : null;

    renderRangeControl();
    renderHeader(b);
    renderKPIs(inRange, prev, b);
    renderCircuit(inRange);

    const hasAny = sessions.length > 0;
    el.empty.hidden = hasAny;
    el.grid.hidden = !hasAny;
    el.exportBtn.disabled = !hasAny;
    if (!hasAny) return;

    renderChart();
    renderCategories(inRange);
    renderSites(inRange);
    renderTable();
  }

  function renderRangeControl() {
    el.range.querySelectorAll('[data-range]').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.range === state.range));
    });
  }

  function renderHeader(b) {
    if (sessions.length === 0) {
      el.heroSub.textContent = 'Nothing recorded yet';
      el.lastUpdated.textContent = 'Waiting for first session';
      return;
    }
    const oldest = sessions[sessions.length - 1];
    el.heroSub.textContent = b
      ? `Last ${b.days} days · ${fmtDate(b.start)} – ${fmtDate(Date.now())}`
      : `All time · since ${fmtDate(oldest.ts, true)}`;
    el.lastUpdated.textContent = `Last session ${fmtRelative(sessions[0].ts)}`;
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — KPIs
  // ══════════════════════════════════════════════════════════════
  function renderKPIs(list, prev, b) {
    const agg = aggregate(list);
    const total = agg.total;

    animateNumber(el.kpiRedacted, total);
    el.kpiRedactedFoot.replaceChildren();
    if (b && prev) {
      const prevTotal = sumItems(prev);
      if (prevTotal > 0) {
        const pct = Math.round(((total - prevTotal) / prevTotal) * 100);
        const delta = h('span', { className: `db-delta${pct > 0 ? ' db-delta--up' : ''}` },
          `${pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} ${Math.abs(pct)}%`);
        el.kpiRedactedFoot.append(delta, `vs previous ${b.days} days`);
      } else {
        el.kpiRedactedFoot.textContent = total > 0 ? `None in the previous ${b.days} days` : 'Nothing redacted in this period';
      }
    } else {
      el.kpiRedactedFoot.textContent = list.length
        ? `≈ ${fmtNum(Math.round(total / list.length))} per session`
        : ' ';
    }

    animateNumber(el.kpiSessions, list.length);
    const withSteps = list.filter((s) => s.steps != null);
    const withDur = list.filter((s) => s.durationMs != null);
    const parts = [];
    if (withSteps.length) parts.push(`avg ${fmtNum(Math.round(avg(withSteps.map((s) => s.steps))))} steps`);
    if (withDur.length) parts.push(`${fmtDuration(avg(withDur.map((s) => s.durationMs)))} each`);
    el.kpiSessionsFoot.textContent = list.length
      ? (parts.length ? parts.join(' · ') : 'completed tasks')
      : 'No sessions in this period';

    const siteMap = groupSites(list);
    animateNumber(el.kpiSites, siteMap.length);
    el.kpiSitesFoot.textContent = siteMap.length ? `Most active: ${siteMap[0].domain}` : ' ';

    const top = CATEGORIES
      .map((c) => ({ c, n: agg.cats[c.key] || 0 }))
      .filter((x) => x.c.key !== 'other' && x.n > 0)
      .sort((a, b2) => b2.n - a.n)[0];
    el.kpiTop.replaceChildren();
    if (top) {
      el.kpiTop.append(swatch(top.c.color), h('span', {}, top.c.label));
      el.kpiTop.title = top.c.label;
      el.kpiTopFoot.textContent = `${fmtNum(top.n)} items · ${pctOf(top.n, total)}% of total`;
    } else {
      el.kpiTop.textContent = '—';
      el.kpiTop.title = '';
      el.kpiTopFoot.textContent = total > 0 ? 'Type detail not recorded' : 'Nothing sensitive found';
    }
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — CHART (stacked bars, one per bucket)
  // ══════════════════════════════════════════════════════════════
  function buildBuckets() {
    const b = rangeBounds(state.range);
    let start;
    let end = startOfDay(Date.now()) + DAY;
    let unit = 'day';

    if (b) {
      start = b.start;
    } else {
      const dated = sessions.filter((s) => s.ts > 0);
      const oldest = dated.length ? startOfDay(dated[dated.length - 1].ts) : end - 7 * DAY;
      start = Math.min(oldest, end - 7 * DAY);
      const spanDays = (end - start) / DAY;
      if (spanDays > 400) unit = 'month';
      else if (spanDays > 45) unit = 'week';
    }

    const buckets = [];
    let cursor = start;
    if (unit === 'week') {
      const d = new Date(start);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
      cursor = d.getTime();
    } else if (unit === 'month') {
      const d = new Date(start);
      cursor = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    }
    while (cursor < end) {
      let next;
      if (unit === 'day') {
        const d = new Date(cursor); d.setDate(d.getDate() + 1); next = d.getTime();
      } else if (unit === 'week') {
        const d = new Date(cursor); d.setDate(d.getDate() + 7); next = d.getTime();
      } else {
        const d = new Date(cursor); next = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      }
      buckets.push({ start: cursor, end: next, cats: {}, total: 0, sessions: 0 });
      cursor = next;
    }

    inRange.forEach((s) => {
      // Buckets are contiguous, so a binary search would work; linear is fine at this scale
      const bk = buckets.find((x) => s.ts >= x.start && s.ts < x.end);
      if (!bk) return;
      bk.sessions += 1;
      bk.total += s.items;
      Object.entries(s.cats).forEach(([k, v]) => { bk.cats[k] = (bk.cats[k] || 0) + v; });
    });

    return { buckets, unit };
  }

  function renderChart() {
    const { buckets, unit } = buildBuckets();
    const unitWord = { day: 'day', week: 'week', month: 'month' }[unit];
    el.chartSub.textContent = `Items masked per ${unitWord}, by category`;

    // Legend — only categories present in this range (all, if none)
    const present = CATEGORIES.filter((c) => buckets.some((bk) => (bk.cats[c.key] || 0) > 0));
    el.legend.replaceChildren(...(present.length ? present : CATEGORIES.slice(0, 5)).map((c) =>
      h('span', { className: 'db-legend__item' }, swatch(c.color), c.label)));

    // Geometry
    el.chart.querySelectorAll('svg').forEach((n) => n.remove());
    const W = Math.max(el.chart.clientWidth, 280);
    const H = Math.max(el.chart.clientHeight, 260);
    const m = { top: 10, right: 6, bottom: 26, left: 38 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;

    const maxVal = Math.max(...buckets.map((bk) => bk.total), 0);
    const { max: yMax, step: yStep } = niceScale(maxVal);
    const slot = pw / buckets.length;
    const barW = Math.max(3, Math.min(30, slot * 0.64));
    const y = (v) => m.top + ph - (v / yMax) * ph;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`,
      width: W,
      height: H,
      role: 'img',
      'aria-label': `Bar chart of redactions per ${unitWord}. Peak ${fmtNum(maxVal)} items. Full detail is in the session history table.`,
    });

    // Gridlines + y labels
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      const yy = Math.round(y(v)) + 0.5;
      svg.append(svgEl('line', { x1: m.left, x2: W - m.right, y1: yy, y2: yy, class: v === 0 ? 'base-line' : 'grid-line' }));
      svg.append(svgEl('text', { x: m.left - 8, y: yy + 4, 'text-anchor': 'end', class: 'axis-text' }, fmtCompact(v)));
    }

    // X labels — at most ~8, always including the last bucket
    const every = Math.max(1, Math.ceil(buckets.length / 8));
    buckets.forEach((bk, i) => {
      const fromEnd = buckets.length - 1 - i;
      if (fromEnd % every !== 0) return;
      const cx = m.left + slot * i + slot / 2;
      svg.append(svgEl('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'axis-text' }, fmtBucket(bk.start, unit)));
    });

    // Columns
    buckets.forEach((bk, i) => {
      const cx = m.left + slot * i + slot / 2;
      const g = svgEl('g', { class: 'col' });
      g.append(svgEl('rect', { class: 'col-hl', x: m.left + slot * i + 1, y: m.top, width: Math.max(slot - 2, 1), height: ph, rx: 6 }));

      const segs = CATEGORIES.filter((c) => (bk.cats[c.key] || 0) > 0);
      let base = y(0);
      segs.forEach((c, si) => {
        const hgt = (bk.cats[c.key] / yMax) * ph;
        const isTop = si === segs.length - 1;
        // 2px surface gap between stacked segments
        const drawH = isTop ? hgt : Math.max(hgt - 2, 1);
        const top = base - hgt;
        const path = svgEl('path', {
          class: 'seg',
          d: isTop ? roundedTopRect(cx - barW / 2, top, barW, drawH, 4) : rectPath(cx - barW / 2, top + (hgt - drawH), barW, drawH),
        });
        path.style.fill = c.color;
        g.append(path);
        base = top;
      });

      const hit = svgEl('rect', { class: 'hit', x: m.left + slot * i, y: m.top, width: slot, height: ph + m.bottom });
      hit.addEventListener('pointerenter', () => showTip(g, bk, unit, cx, W));
      hit.addEventListener('pointerleave', hideTip);
      g.append(hit);
      svg.append(g);
    });

    el.chart.prepend(svg);
  }

  function showTip(g, bk, unit, cx, W) {
    el.chart.classList.add('has-hover');
    el.chart.querySelectorAll('.col.is-hover').forEach((n) => n.classList.remove('is-hover'));
    g.classList.add('is-hover');

    const rows = CATEGORIES.filter((c) => (bk.cats[c.key] || 0) > 0).reverse().map((c) =>
      h('div', { className: 'db-tip__row' }, swatch(c.color), c.label, h('b', {}, fmtNum(bk.cats[c.key]))));

    el.tip.replaceChildren(
      h('div', { className: 'db-tip__head' },
        h('span', {}, fmtBucketLong(bk, unit)),
        h('span', {}, `${fmtNum(bk.total)} items`)),
      ...(rows.length ? rows : [h('div', { className: 'db-tip__muted' }, bk.sessions ? 'No sensitive data on these pages' : 'No sessions')]),
      ...(bk.sessions ? [h('div', { className: 'db-tip__muted', style: 'margin-top:6px' }, `${bk.sessions} session${bk.sessions === 1 ? '' : 's'}`)] : []),
    );
    el.tip.hidden = false;
    const tw = el.tip.offsetWidth;
    const left = cx + 14 + tw > W ? cx - 14 - tw : cx + 14;
    el.tip.style.left = `${Math.max(0, left)}px`;
    el.tip.style.top = '8px';
  }

  function hideTip() {
    el.tip.hidden = true;
    el.chart.classList.remove('has-hover');
    el.chart.querySelectorAll('.col.is-hover').forEach((n) => n.classList.remove('is-hover'));
  }

  function niceScale(max) {
    if (max <= 0) return { max: 4, step: 1 };
    const rough = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const niceStep = step < 1 ? 1 : step;
    return { max: Math.ceil(max / niceStep) * niceStep, step: niceStep };
  }

  function rectPath(x, y, w, hh) {
    return `M${x},${y}h${w}v${hh}h${-w}Z`;
  }

  function roundedTopRect(x, y, w, hh, r) {
    const rr = Math.min(r, w / 2, hh);
    return `M${x},${y + hh}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hh}Z`;
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — CATEGORIES
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // HERO CIRCUIT — pulses travel from categories into the hub and out
  // ══════════════════════════════════════════════════════════════
  function initCircuit() {
    const svg = $('db-circuit');
    if (!svg) return;
    // Seconds each pulse waits before its first run. Inputs and detectors
    // cascade into the hub; the bottom loop (hub → Server → LLM → hub) runs
    // in order on a shared cycle.
    const counters = { in: 0, side: 0, bus: 0 };
    const LOOP_DELAY = { out: 0.6, link: 2.1, back: 3.6 };
    svg.querySelectorAll('[data-flow]').forEach((trace) => {
      const flow = trace.dataset.flow;
      const pulse = trace.cloneNode();
      pulse.removeAttribute('data-flow');
      const variant = flow === 'bus' ? ' cx-pulse--bus' : flow in LOOP_DELAY ? ' cx-pulse--out' : '';
      pulse.setAttribute('class', `cx-pulse${variant}`);
      pulse.setAttribute('pathLength', '100');
      const delay = flow in LOOP_DELAY ? LOOP_DELAY[flow]
        : flow === 'in' ? counters.in++ * 0.35
          : flow === 'side' ? 0.18 + counters.side++ * 0.35
            : counters.bus++ * 0.55;
      pulse.style.animationDelay = `${delay}s`;
      trace.after(pulse);
    });
  }

  function renderCircuit(list) {
    const agg = aggregate(list);
    document.querySelectorAll('#db-circuit .cx-row[data-cat]').forEach((row) => {
      const cat = CAT_BY_KEY[row.dataset.cat];
      const n = agg.cats[row.dataset.cat] || 0;
      row.classList.toggle('is-idle', sessions.length > 0 && n === 0);
      let title = row.querySelector('title');
      if (!title) {
        title = svgEl('title');
        row.prepend(title);
      }
      title.textContent = `${cat.label}: ${fmtNum(n)} redacted`;
    });
  }

  function renderCategories(list) {
    const agg = aggregate(list);
    const total = agg.total;

    // Share bar
    el.share.replaceChildren(...CATEGORIES.filter((c) => (agg.cats[c.key] || 0) > 0).map((c) => {
      const seg = h('div', { className: 'db-share__seg', title: `${c.label}: ${fmtNum(agg.cats[c.key])}` });
      seg.style.background = c.color;
      seg.style.flexGrow = String(agg.cats[c.key]);
      return seg;
    }));

    el.cats.replaceChildren(...CATEGORIES.map((c) => {
      const n = agg.cats[c.key] || 0;
      const subs = c.types
        .map((t) => ({ t, n: agg.types[t] || 0 }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n);

      const li = h('li', { className: `db-cat${state.openCats.has(c.key) && subs.length ? ' is-open' : ''}` });
      const row = h('button', { className: 'db-cat__row', 'aria-expanded': String(state.openCats.has(c.key)) },
        swatch(c.color),
        h('span', { className: 'db-cat__name' }, c.label),
        h('span', { className: 'db-cat__count' }, fmtNum(n)),
        h('span', { className: 'db-cat__pct' }, total ? `${pctOf(n, total)}%` : '—'),
        chevronRight());
      row.disabled = subs.length === 0;
      row.addEventListener('click', () => {
        const open = !li.classList.contains('is-open');
        li.classList.toggle('is-open', open);
        row.setAttribute('aria-expanded', String(open));
        if (open) state.openCats.add(c.key); else state.openCats.delete(c.key);
      });

      const subList = h('ul', { className: 'db-cat__subs' }, ...subs.map((s) => {
        const fill = h('div', { className: 'db-sub__fill' });
        fill.style.background = c.color;
        fill.style.width = `${Math.max(3, (s.n / n) * 100)}%`;
        return h('li', { className: 'db-sub' },
          h('span', {}, TYPE_LABELS[s.t] || s.t),
          h('span', {}, fmtNum(s.n)),
          h('div', { className: 'db-sub__bar' }, fill));
      }));

      li.append(row, subList);
      if (n === 0) li.style.opacity = '0.5';
      return li;
    }));

    const legacy = list.filter((s) => !s.hasBreakdown && s.items > 0).length;
    el.catsNote.hidden = legacy === 0;
    el.catsNote.textContent = legacy
      ? `${legacy} session${legacy === 1 ? ' was' : 's were'} recorded before per-type tracking, so ${legacy === 1 ? 'its' : 'their'} items appear under Other / unclassified.`
      : '';
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — SITES
  // ══════════════════════════════════════════════════════════════
  function groupSites(list) {
    const map = new Map();
    list.forEach((s) => {
      const x = map.get(s.domain) || { domain: s.domain, items: 0, sessions: 0, last: 0 };
      x.items += s.items;
      x.sessions += 1;
      x.last = Math.max(x.last, s.ts);
      map.set(s.domain, x);
    });
    return [...map.values()].sort((a, b) => b.items - a.items || b.sessions - a.sessions || b.last - a.last);
  }

  function renderSites(list) {
    const sites = groupSites(list).slice(0, 7);
    if (!sites.length) {
      el.sites.replaceChildren(h('li', { className: 'db-empty-line' }, 'No sessions in this period.'));
      return;
    }
    const max = Math.max(...sites.map((s) => s.items), 1);
    el.sites.replaceChildren(...sites.map((s) => {
      const bar = h('i');
      bar.style.width = `${Math.max(4, (s.items / max) * 100)}%`;
      const btn = h('button', {
        className: `db-site${state.site === s.domain ? ' is-active' : ''}`,
        title: `Show sessions on ${s.domain}`,
        'aria-pressed': String(state.site === s.domain),
      },
        h('span', { className: 'db-site__mono' }, monogram(s.domain)),
        h('span', { className: 'db-site__name' }, s.domain),
        h('span', { className: 'db-site__count' }, fmtNum(s.items)),
        h('span', { className: 'db-site__meta' }, `${s.sessions} session${s.sessions === 1 ? '' : 's'} · ${fmtRelative(s.last)}`),
        h('span', { className: 'db-site__bar' }, bar));
      btn.addEventListener('click', () => setSiteFilter(state.site === s.domain ? null : s.domain));
      return h('li', {}, btn);
    }));
  }

  function setSiteFilter(domain) {
    state.site = domain;
    state.page = 0;
    renderSites(inRange);
    renderTable();
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — HISTORY TABLE
  // ══════════════════════════════════════════════════════════════
  const SORTERS = {
    time: (s) => s.ts,
    domain: (s) => s.domain.toLowerCase(),
    items: (s) => s.items,
    steps: (s) => s.steps ?? -1,
    duration: (s) => s.durationMs ?? -1,
  };

  function tableRows() {
    const q = state.query.trim().toLowerCase();
    let rows = inRange;
    if (state.site) rows = rows.filter((s) => s.domain === state.site);
    if (q) rows = rows.filter((s) => s.prompt.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q));
    const get = SORTERS[state.sort.key];
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a); const vb = get(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir || b.ts - a.ts;
    });
  }

  function renderTable() {
    const rows = tableRows();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const pageRows = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

    // Sort indicators
    document.querySelectorAll('.db-sort').forEach((btn) => {
      if (btn.dataset.sort === state.sort.key) btn.dataset.dir = state.sort.dir;
      else delete btn.dataset.dir;
    });

    el.filterChip.hidden = !state.site;
    el.filterSite.textContent = state.site || '';
    el.historySub.textContent = rows.length === inRange.length
      ? `${fmtNum(rows.length)} session${rows.length === 1 ? '' : 's'} in this period`
      : `${fmtNum(rows.length)} of ${fmtNum(inRange.length)} sessions`;

    const frag = document.createDocumentFragment();
    pageRows.forEach((s) => {
      const open = state.openRows.has(s.key);
      const tr = h('tr', { className: `db-row${open ? ' is-open' : ''}`, tabIndex: 0, 'aria-expanded': String(open) });

      const task = h('td', { className: 'db-td--task', title: s.prompt }, s.prompt || '—');
      const site = h('td', { className: 'db-td--site', title: s.domain }, s.domain);

      const expandBtn = h('button', { className: 'db-row-btn', title: open ? 'Hide details' : 'Show details', 'aria-label': 'Toggle details' }, chevronDown());
      const delBtn = h('button', { className: 'db-row-btn db-row-btn--del', title: 'Delete this session', 'aria-label': 'Delete session' }, trashIcon());
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s.key); });

      tr.append(
        h('td', { className: 'db-td--when' },
          h('span', { className: 'db-when__rel' }, fmtRelative(s.ts)),
          h('span', { className: 'db-when__abs' }, fmtDateTime(s.ts))),
        site,
        task,
        h('td', { className: 'db-td--num' }, miniBar(s), h('b', {}, fmtNum(s.items))),
        h('td', { className: 'db-td--num db-hide-md' }, s.steps != null ? fmtNum(s.steps) : '—'),
        h('td', { className: 'db-td--num db-hide-md' }, s.durationMs != null ? fmtDuration(s.durationMs) : '—'),
        h('td', { className: 'db-td--act' }, expandBtn, delBtn),
      );

      const toggle = () => {
        if (state.openRows.has(s.key)) state.openRows.delete(s.key); else state.openRows.add(s.key);
        renderTable();
      };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); toggle(); }
      });

      frag.append(tr);
      if (open) frag.append(detailRow(s));
    });
    el.tableBody.replaceChildren(frag);

    el.tableEmpty.hidden = rows.length > 0;
    el.tableEmpty.textContent = inRange.length ? 'No sessions match your filters.' : 'No sessions in this period — try a longer range.';
    el.pager.hidden = rows.length <= PAGE_SIZE;
    el.pagerInfo.textContent = `${state.page * PAGE_SIZE + 1}–${Math.min((state.page + 1) * PAGE_SIZE, rows.length)} of ${fmtNum(rows.length)}`;
    el.prev.disabled = state.page === 0;
    el.next.disabled = state.page >= pages - 1;
  }

  function detailRow(s) {
    const chips = Object.entries(s.types)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => h('span', { className: 'db-chip' },
        swatch(CAT_BY_KEY[TYPE_TO_CAT[t] || 'other'].color),
        TYPE_LABELS[t] || t,
        h('b', {}, fmtNum(n))));

    const meta = [fmtDateTime(s.ts, true)];
    if (s.steps != null) meta.push(`${s.steps} step${s.steps === 1 ? '' : 's'}`);
    if (s.durationMs != null) meta.push(`took ${fmtDuration(s.durationMs)}`);

    return h('tr', { className: 'db-detail' },
      h('td', { colSpan: 7 },
        h('div', { className: 'db-detail__inner' },
          h('div', {},
            h('div', { className: 'db-detail__lbl' }, 'Task'),
            h('div', { className: 'db-detail__task' }, s.prompt || '—'),
            h('div', { className: 'db-detail__meta' }, ...meta.map((x) => h('span', {}, x)))),
          h('div', {},
            h('div', { className: 'db-detail__lbl' }, 'Redacted on this run'),
            chips.length
              ? h('div', { className: 'db-chips' }, ...chips)
              : h('div', { className: 'db-tip__muted' }, 'No sensitive data was found on the pages visited.')))));
  }

  function miniBar(s) {
    const bar = h('span', { className: 'db-mini', 'aria-hidden': 'true' });
    if (s.items > 0) {
      CATEGORIES.forEach((c) => {
        const n = s.cats[c.key] || 0;
        if (!n) return;
        const seg = h('i');
        seg.style.flexGrow = String(n);
        seg.style.background = c.color;
        bar.append(seg);
      });
    }
    return bar;
  }

  // ══════════════════════════════════════════════════════════════
  // MUTATIONS — delete / clear with undo
  // ══════════════════════════════════════════════════════════════
  async function deleteSession(key) {
    const current = await loadHistory();
    const index = current.findIndex((r) => recordKey(r) === key);
    if (index < 0) return;
    const [removed] = current.splice(index, 1);
    await saveHistory(current);
    showToast('Session deleted', async () => {
      const now = await loadHistory();
      now.splice(Math.min(index, now.length), 0, removed);
      await saveHistory(now);
    });
  }

  async function confirmClear() {
    hideClearModal();
    const snapshot = await loadHistory();
    await saveHistory([]);
    state.site = null;
    state.openRows.clear();
    showToast(`Cleared ${fmtNum(snapshot.length)} sessions`, async () => {
      const now = await loadHistory();
      await saveHistory(snapshot.concat(now));
    });
  }

  function showToast(message, onUndo) {
    clearTimeout(toastTimer);
    undoAction = onUndo;
    el.toastMsg.textContent = message;
    el.toastUndo.hidden = !onUndo;
    el.toast.hidden = false;
    toastTimer = setTimeout(hideToast, 7000);
  }

  function hideToast() {
    el.toast.hidden = true;
    undoAction = null;
  }

  // ══════════════════════════════════════════════════════════════
  // MODAL
  // ══════════════════════════════════════════════════════════════
  function showClearModal() {
    modalReturnFocus = document.activeElement;
    el.modalCount.textContent = fmtNum(raw.length);
    el.modalOverlay.hidden = false;
    el.modalCancel.focus();
  }

  function hideClearModal() {
    if (el.modalOverlay.hidden) return;
    el.modalOverlay.hidden = true;
    if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
  }

  function trapModalFocus(e) {
    if (el.modalOverlay.hidden || e.key !== 'Tab') return;
    const first = el.modalCancel;
    const last = el.modalConfirm;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ══════════════════════════════════════════════════════════════
  // CSV EXPORT
  // ══════════════════════════════════════════════════════════════
  function csvCell(value) {
    let s = value == null ? '' : String(value);
    // Neutralize spreadsheet formula injection from task text / domains
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCSV() {
    const typeKeys = Object.keys(TYPE_LABELS);
    const headers = ['Date', 'Domain', 'Task', 'Items redacted', 'Steps', 'Duration (s)',
      'Protection rate (%)', ...typeKeys.map((k) => TYPE_LABELS[k])];

    const rows = [...raw]
      .sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0))
      .map((r) => {
        const s = normalize(r);
        return [
          s.ts ? new Date(s.ts).toISOString() : '',
          s.domain,
          s.prompt,
          s.items,
          s.steps ?? '',
          s.durationMs != null ? Math.round(s.durationMs / 1000) : '',
          r.protectionRate ?? '',
          ...typeKeys.map((k) => s.types[k] || 0),
        ].map(csvCell).join(',');
      });

    const csv = '﻿' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `privsight-history-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ══════════════════════════════════════════════════════════════
  // THEME
  // ══════════════════════════════════════════════════════════════
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function effectiveTheme() {
    return document.documentElement.dataset.theme || (darkQuery.matches ? 'dark' : 'light');
  }

  function initTheme() {
    const saved = readPref(PREF_THEME, '');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  }

  function toggleTheme() {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writePref(PREF_THEME, next);
  }

  // ══════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'className') node.className = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k in node && !k.includes('-')) node[k] = v;
      else node.setAttribute(k, v);
    });
    children.forEach((c) => { if (c != null) node.append(c); });
    return node;
  }

  function svgEl(tag, attrs = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(paths, size = 14) {
    const s = svgEl('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    paths.forEach((d) => s.append(svgEl('path', { d })));
    return s;
  }
  const chevronRight = () => { const i = icon(['M9 6l6 6-6 6'], 14); i.classList.add('db-cat__chev'); return i; };
  const chevronDown = () => { const i = icon(['M6 9l6 6 6-6'], 14); i.classList.add('chev'); return i; };
  const trashIcon = () => icon(['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'], 13);

  function swatch(color) {
    const s = h('span', { className: 'db-swatch', 'aria-hidden': 'true' });
    s.style.background = color;
    return s;
  }

  function monogram(domain) {
    const clean = domain.replace(/^www\./, '');
    return (clean.match(/[a-z0-9]/i) || ['?'])[0];
  }

  function animateNumber(node, to) {
    const from = parseInt(node.textContent.replace(/[^0-9]/g, ''), 10) || 0;
    if (from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.textContent = fmtNum(to);
      return;
    }
    const start = performance.now();
    const duration = 700;
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = fmtNum(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const avg = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  const pctOf = (n, total) => (total ? Math.round((n / total) * 100) : 0);
  const fmtNum = (n) => Number(n || 0).toLocaleString();

  function fmtCompact(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n);
  }

  function fmtDate(t, withYear) {
    return new Date(t).toLocaleDateString(undefined, withYear
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' });
  }

  function fmtDateTime(t, long) {
    if (!t) return '—';
    const d = new Date(t);
    return d.toLocaleDateString(undefined, long
      ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' })
      + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function fmtRelative(t) {
    if (!t) return '—';
    const diff = Date.now() - t;
    if (diff < 45000) return 'just now';
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (t >= startOfDay(Date.now())) return `${Math.round(diff / 3600000)}h ago`;
    if (t >= startOfDay(Date.now()) - DAY) return 'yesterday';
    if (diff < 7 * DAY) return `${Math.ceil(diff / DAY)}d ago`;
    return fmtDate(t, new Date(t).getFullYear() !== new Date().getFullYear());
  }

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function fmtBucket(t, unit) {
    if (unit === 'month') return new Date(t).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    return fmtDate(t);
  }

  function fmtBucketLong(bk, unit) {
    if (unit === 'day') return new Date(bk.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (unit === 'week') return `Week of ${fmtDate(bk.start)}`;
    return new Date(bk.start).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════
  async function init() {
    initTheme();
    initCircuit();

    setHistory(await loadHistory());
    renderAll();

    // Range
    el.range.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn || btn.dataset.range === state.range) return;
      state.range = btn.dataset.range;
      state.page = 0;
      writePref(PREF_RANGE, state.range);
      hideTip();
      renderAll();
    });

    el.themeBtn.addEventListener('click', toggleTheme);
    el.exportBtn.addEventListener('click', exportCSV);

    // Table controls
    el.search.addEventListener('input', () => {
      state.query = el.search.value;
      state.page = 0;
      renderTable();
    });
    el.filterClear.addEventListener('click', () => setSiteFilter(null));
    el.prev.addEventListener('click', () => { state.page -= 1; renderTable(); });
    el.next.addEventListener('click', () => { state.page += 1; renderTable(); });
    document.querySelectorAll('.db-sort').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sort;
        state.sort = state.sort.key === key
          ? { key, dir: state.sort.dir === 'desc' ? 'asc' : 'desc' }
          : { key, dir: key === 'domain' ? 'asc' : 'desc' };
        state.page = 0;
        renderTable();
      });
    });

    // Clear-all modal
    el.clearBtn.addEventListener('click', showClearModal);
    el.modalCancel.addEventListener('click', hideClearModal);
    el.modalConfirm.addEventListener('click', confirmClear);
    el.modalOverlay.addEventListener('click', (e) => { if (e.target === el.modalOverlay) hideClearModal(); });

    // Toast
    el.toastUndo.addEventListener('click', async () => {
      const action = undoAction;
      hideToast();
      if (action) await action();
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      trapModalFocus(e);
      if (e.key === 'Escape') {
        if (!el.modalOverlay.hidden) { hideClearModal(); return; }
        if (document.activeElement === el.search && el.search.value) {
          el.search.value = '';
          state.query = '';
          renderTable();
        }
      }
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (e.key === '/' && !typing && el.modalOverlay.hidden && !el.grid.hidden) {
        e.preventDefault();
        el.search.focus();
      }
    });

    // Chart follows its container width
    let resizeFrame = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (!el.grid.hidden) renderChart(); });
    }).observe(el.chart);

    // Live-update when the side panel records a session (or another tab edits history)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEY]) {
        setHistory(changes[STORAGE_KEY].newValue || []);
        renderAll();
      }
    });

    // Keep relative times fresh
    setInterval(() => {
      if (!sessions.length) return;
      renderHeader(rangeBounds(state.range));
      renderTable();
    }, 60000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
