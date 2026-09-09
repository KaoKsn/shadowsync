/**
 * PrivSight Analytics Dashboard (dashboard.js)
 *
 * Reads 'privsight-history' from chrome.storage.local and renders:
 *  - All-time hero stats (sessions, found, sensitive, removed, protection rate)
 *  - SVG sparkline: protection % per session
 *  - Data type breakdown bars (email, phone, credit card, SSN, password, other)
 *  - Top protected domains ranked list
 *  - Full session history table (newest first)
 *  - CSV export
 *  - Clear history with confirmation modal
 *  - Theme toggle (persists to localStorage, matching sidepanel)
 */

(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const el = {
    themeToggle:    $('db-theme-toggle'),
    iconMoon:       $('db-icon-moon'),
    iconSun:        $('db-icon-sun'),
    lastUpdated:    $('db-last-updated'),
    exportBtn:      $('db-export-btn'),
    clearBtn:       $('db-clear-btn'),

    // Hero stats
    totalSessions:  $('db-total-sessions'),
    totalFound:     $('db-total-found'),
    totalSensitive: $('db-total-sensitive'),
    totalRemoved:   $('db-total-removed'),
    protectionRate: $('db-protection-rate'),

    // Sections
    empty:          $('db-empty'),
    grid:           $('db-grid'),

    // Chart
    chart:          $('db-chart'),
    trendBadge:     $('db-trend-badge'),

    // Breakdown
    breakdown:      $('db-breakdown'),

    // Domains
    domains:        $('db-domains'),

    // Table
    tableBody:      $('db-table-body'),

    // Modal
    modalOverlay:   $('db-modal-overlay'),
    modalCount:     $('db-modal-count'),
    modalCancel:    $('db-modal-cancel'),
    modalConfirm:   $('db-modal-confirm'),
  };

  // ── State ─────────────────────────────────────────────────────
  let history = []; // array of session records

  // ── Data type config — distinct colors on glass background ───
  const DATA_TYPES = [
    { key: 'email',      label: 'Email Addresses', color: '#38bdf8' },  // sky blue
    { key: 'phone',      label: 'Phone Numbers',   color: '#a78bfa' },  // violet
    { key: 'creditCard', label: 'Credit Cards',    color: '#f472b6' },  // pink
    { key: 'password',   label: 'Passwords',       color: '#fb923c' },  // orange
    { key: 'ssn',        label: 'SSN / Gov IDs',   color: '#f87171' },  // red
    { key: 'other',      label: 'Other',           color: '#94a3b8' },  // slate
  ];

  // ══════════════════════════════════════════════════════════════
  // STORAGE
  // ══════════════════════════════════════════════════════════════
  function loadHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ 'privsight-history': [] }, (result) => {
        resolve(result['privsight-history'] || []);
      });
    });
  }

  function clearHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ 'privsight-history': [] }, resolve);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // THEME
  // ══════════════════════════════════════════════════════════════
  function initTheme() {
    const saved = localStorage.getItem('privsight-theme') || 'dark';
    applyTheme(saved);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    el.iconMoon.style.display = theme === 'dark'  ? 'block' : 'none';
    el.iconSun.style.display  = theme === 'light' ? 'block' : 'none';
    localStorage.setItem('privsight-theme', theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // ══════════════════════════════════════════════════════════════
  // NUMBER ANIMATION
  // ══════════════════════════════════════════════════════════════
  function animateNumber(element, to, suffix = '') {
    const from = parseInt(element.textContent.replace(/[^0-9]/g, ''), 10) || 0;
    if (from === to) {
      element.textContent = to.toLocaleString() + suffix;
      return;
    }
    const duration = 900;
    const start = performance.now();
    element.classList.add('animating');

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (to - from) * eased);
      element.textContent = value.toLocaleString() + suffix;
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        element.textContent = to.toLocaleString() + suffix;
        element.classList.remove('animating');
      }
    }
    requestAnimationFrame(tick);
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — HERO STATS
  // ══════════════════════════════════════════════════════════════
  function renderHeroStats(sessions) {
    const totalSessions  = sessions.length;
    const totalFound     = sessions.reduce((s, r) => s + (r.dataFound || 0), 0);
    const totalSensitive = sessions.reduce((s, r) => s + (r.sensitiveRecognized || 0), 0);
    const totalRemoved   = sessions.reduce((s, r) => s + (r.sensitiveRemoved || 0), 0);
    const rate = totalSensitive > 0
      ? Math.round((totalRemoved / totalSensitive) * 100)
      : (totalSessions > 0 ? 100 : 0);

    animateNumber(el.totalSessions,  totalSessions);
    animateNumber(el.totalFound,     totalFound);
    animateNumber(el.totalSensitive, totalSensitive);
    animateNumber(el.totalRemoved,   totalRemoved);
    animateNumber(el.protectionRate, rate, '%');
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — SPARKLINE CHART
  // ══════════════════════════════════════════════════════════════
  function renderChart(sessions) {
    const svg = el.chart;
    svg.innerHTML = `
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#38bdf8" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
        </linearGradient>
      </defs>`;

    const rates = sessions.map(s => s.protectionRate || 0);

    // Trend badge — average rate
    const avg = rates.length
      ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
      : 0;
    el.trendBadge.textContent = `avg ${avg}%`;

    if (rates.length < 2) {
      // Not enough data — show a placeholder message
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '50%');
      text.setAttribute('y', '50%');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', '#44506a');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-family', 'Inter, sans-serif');
      text.textContent = rates.length === 0
        ? 'No data yet'
        : 'Run more sessions to see the trend';
      svg.appendChild(text);
      return;
    }

    // Get rendered dimensions
    const bbox = svg.getBoundingClientRect();
    const W = bbox.width  || 340;
    const H = bbox.height || 140;
    const pad = { top: 16, right: 20, bottom: 24, left: 36 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top  - pad.bottom;

    const minRate = Math.max(0, Math.min(...rates) - 10);
    const maxRate = Math.min(100, Math.max(...rates) + 10);

    const xScale = (i) => pad.left + (i / (rates.length - 1)) * chartW;
    const yScale = (v) => pad.top  + (1 - (v - minRate) / (maxRate - minRate)) * chartH;

    // Y-axis grid lines
    [0, 25, 50, 75, 100].forEach((v) => {
      if (v < minRate || v > maxRate) return;
      const y = yScale(v);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', pad.left);
      line.setAttribute('x2', W - pad.right);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255,255,255,0.04)');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', pad.left - 6);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#44506a');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'Inter, sans-serif');
      label.textContent = v + '%';
      svg.appendChild(label);
    });

    // Build path points
    const points = rates.map((v, i) => [xScale(i), yScale(v)]);

    // Area fill path
    const areaD = [
      `M ${points[0][0]} ${H - pad.bottom}`,
      ...points.map(([x, y]) => `L ${x} ${y}`),
      `L ${points[points.length - 1][0]} ${H - pad.bottom}`,
      'Z',
    ].join(' ');

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', areaD);
    area.setAttribute('fill', 'url(#chartGrad)');
    svg.appendChild(area);

    // Line path (smooth with bezier)
    let lineD = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const cpX = (x0 + x1) / 2;
      lineD += ` C ${cpX} ${y0}, ${cpX} ${y1}, ${x1} ${y1}`;
    }

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', lineD);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#38bdf8');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');

    // Animate the line drawing
    const length = line.getTotalLength ? line.getTotalLength() : 1000;
    line.style.strokeDasharray  = length;
    line.style.strokeDashoffset = length;
    line.style.transition = `stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)`;
    svg.appendChild(line);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { line.style.strokeDashoffset = '0'; });
    });

    // Data point circles
    points.forEach(([cx, cy], i) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', '3.5');
      circle.setAttribute('fill', '#38bdf8');
      circle.setAttribute('stroke', '#080808');
      circle.setAttribute('stroke-width', '2');

      // Tooltip title
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `Session ${i + 1}: ${rates[i]}%`;
      circle.appendChild(title);
      svg.appendChild(circle);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — DATA TYPE BREAKDOWN
  // ══════════════════════════════════════════════════════════════
  function renderBreakdown(sessions) {
    // Sum all breakdown counts across sessions
    const totals = {};
    DATA_TYPES.forEach(dt => { totals[dt.key] = 0; });

    sessions.forEach(s => {
      if (s.breakdown) {
        DATA_TYPES.forEach(dt => {
          totals[dt.key] += s.breakdown[dt.key] || 0;
        });
      }
    });

    const max = Math.max(...Object.values(totals), 1);

    el.breakdown.innerHTML = '';
    DATA_TYPES.forEach(dt => {
      const count = totals[dt.key];
      const pct   = Math.round((count / max) * 100);

      const row = document.createElement('div');
      row.className = 'db-bk-row';
      row.innerHTML = `
        <div class="db-bk-row__head">
          <span class="db-bk-row__name">
            <span class="db-bk-dot" style="background:${dt.color}"></span>
            ${dt.label}
          </span>
          <span class="db-bk-row__count">${count.toLocaleString()}</span>
        </div>
        <div class="db-bk-bar">
          <div class="db-bk-fill" style="width:0%; background:${dt.color}"></div>
        </div>
      `;
      el.breakdown.appendChild(row);

      // Animate fill
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const fill = row.querySelector('.db-bk-fill');
          fill.style.width = `${pct}%`;
        });
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — TOP DOMAINS
  // ══════════════════════════════════════════════════════════════
  function renderDomains(sessions) {
    // Aggregate sensitive count per domain
    const domainMap = {};
    sessions.forEach(s => {
      const d = s.domain || 'Unknown';
      domainMap[d] = (domainMap[d] || 0) + (s.sensitiveRecognized || 0);
    });

    const sorted = Object.entries(domainMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7);

    el.domains.innerHTML = '';

    if (sorted.length === 0) {
      el.domains.innerHTML = '<li style="color:var(--text-muted);font-size:12px;padding:8px 0;">No domain data yet.</li>';
      return;
    }

    sorted.forEach(([domain, count], i) => {
      const rank = i + 1;
      const li = document.createElement('li');
      li.className = 'db-domain-item';
      li.style.animationDelay = `${i * 0.05}s`;
      li.innerHTML = `
        <span class="db-domain-rank db-domain-rank--${rank <= 3 ? rank : ''}">${rank}</span>
        <span class="db-domain-name" title="${domain}">${domain}</span>
        <span class="db-domain-count">${count.toLocaleString()} items</span>
      `;
      el.domains.appendChild(li);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — SESSION HISTORY TABLE
  // ══════════════════════════════════════════════════════════════
  function renderTable(sessions) {
    el.tableBody.innerHTML = '';

    // Newest first
    const sorted = [...sessions].reverse();

    sorted.forEach((s, i) => {
      const rate    = s.protectionRate || 0;
      const rateClass = rate >= 90 ? 'high' : rate >= 60 ? 'med' : 'low';
      const dateFmt = formatDateTime(s.timestamp);
      const task    = s.prompt ? truncate(s.prompt, 45) : '—';

      const tr = document.createElement('tr');
      tr.style.animationDelay = `${i * 0.04}s`;
      tr.innerHTML = `
        <td class="db-td--date">${dateFmt}</td>
        <td class="db-td--domain" title="${s.domain || '—'}">${s.domain || '—'}</td>
        <td class="db-td--task" title="${s.prompt || ''}">${task}</td>
        <td class="db-td--right">${(s.dataFound || 0).toLocaleString()}</td>
        <td class="db-td--right">${(s.sensitiveRecognized || 0).toLocaleString()}</td>
        <td class="db-td--right">${(s.sensitiveRemoved || 0).toLocaleString()}</td>
        <td class="db-td--right">
          <span class="db-rate-badge db-rate-badge--${rateClass}">${rate}%</span>
        </td>
      `;
      el.tableBody.appendChild(tr);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER — LAST UPDATED
  // ══════════════════════════════════════════════════════════════
  function renderLastUpdated(sessions) {
    if (sessions.length === 0) {
      el.lastUpdated.textContent = 'No sessions recorded';
      return;
    }
    const latest = sessions[sessions.length - 1];
    const dt = formatDateTime(latest.timestamp);
    el.lastUpdated.textContent = `Last session: ${dt}`;
  }

  // ══════════════════════════════════════════════════════════════
  // FULL RENDER
  // ══════════════════════════════════════════════════════════════
  function renderAll(sessions) {
    renderLastUpdated(sessions);
    renderHeroStats(sessions);

    if (sessions.length === 0) {
      el.empty.style.display = 'flex';
      el.grid.style.display  = 'none';
      return;
    }

    el.empty.style.display = 'none';
    el.grid.style.display  = 'grid';

    renderChart(sessions);
    renderBreakdown(sessions);
    renderDomains(sessions);
    renderTable(sessions);
  }

  // ══════════════════════════════════════════════════════════════
  // CSV EXPORT
  // ══════════════════════════════════════════════════════════════
  function exportCSV(sessions) {
    const headers = [
      'Date', 'Time', 'Domain', 'Task',
      'Data Found', 'Sensitive', 'Removed', 'Protection Rate (%)',
      'Email', 'Phone', 'Credit Card', 'Password', 'SSN', 'Other'
    ];

    const rows = sessions.map(s => {
      const dt = s.timestamp ? new Date(s.timestamp) : new Date();
      const bd = s.breakdown || {};
      return [
        dt.toLocaleDateString(),
        dt.toLocaleTimeString(),
        `"${(s.domain || '').replace(/"/g, '""')}"`,
        `"${(s.prompt || '').replace(/"/g, '""')}"`,
        s.dataFound || 0,
        s.sensitiveRecognized || 0,
        s.sensitiveRemoved || 0,
        s.protectionRate || 0,
        bd.email || 0,
        bd.phone || 0,
        bd.creditCard || 0,
        bd.password || 0,
        bd.ssn || 0,
        bd.other || 0,
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `privsight-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ══════════════════════════════════════════════════════════════
  // MODAL — CLEAR HISTORY
  // ══════════════════════════════════════════════════════════════
  function showClearModal() {
    el.modalCount.textContent = history.length;
    el.modalOverlay.style.display = 'flex';
  }

  function hideClearModal() {
    el.modalOverlay.style.display = 'none';
  }

  async function confirmClear() {
    hideClearModal();
    await clearHistory();
    history = [];
    renderAll(history);
  }

  // ══════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════
  function formatDateTime(iso) {
    if (!iso) return '—';
    try {
      const dt = new Date(iso);
      return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        + ' · ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════
  // LIQUID GLASS CURSOR ENGINE
  // ══════════════════════════════════════════════════════════════
  function initCursor() {
    const ring = document.getElementById('db-cursor');
    const dot  = document.getElementById('db-cursor-trail');
    if (!ring || !dot) return;

    const RING_R = 11;  // half of 22px ring
    const DOT_R  = 2;   // half of 4px dot

    let mouseX = window.innerWidth  / 2;
    let mouseY = window.innerHeight / 2;
    let ringX  = mouseX, ringY = mouseY;
    let dotX   = mouseX, dotY  = mouseY;

    // Previous ring position — used to compute velocity for stretch
    let prevRingX = mouseX, prevRingY = mouseY;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    document.addEventListener('mouseleave', () => {
      ring.style.opacity = '0';
      dot.style.opacity  = '0';
    });
    document.addEventListener('mouseenter', () => {
      ring.style.opacity = '1';
      dot.style.opacity  = '1';
    });

    // Hover: ring expands
    const INTERACTIVE = 'a, button, [role="button"], input, select, textarea, label, th, tr';
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest(INTERACTIVE)) document.body.classList.add('db-cursor--hover');
    });
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest(INTERACTIVE)) document.body.classList.remove('db-cursor--hover');
    });

    // Click: ring snaps in + ripple
    document.addEventListener('mousedown', () => {
      document.body.classList.add('db-cursor--click');
    });
    document.addEventListener('mouseup', () => {
      document.body.classList.remove('db-cursor--click');
    });
    document.addEventListener('click', (e) => {
      const ripple = document.createElement('div');
      ripple.className = 'db-cursor-ripple';
      ripple.style.left = e.clientX + 'px';
      ripple.style.top  = e.clientY + 'px';
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    });

    function tick() {
      // Dot: near-instant (0.65 lerp)
      dotX  += (mouseX - dotX)  * 0.65;
      dotY  += (mouseY - dotY)  * 0.65;

      // Ring: smooth lag (0.10 lerp)
      prevRingX = ringX;
      prevRingY = ringY;
      ringX += (mouseX - ringX) * 0.10;
      ringY += (mouseY - ringY) * 0.10;

      // Velocity = how far ring moved this frame
      const vx = ringX - prevRingX;
      const vy = ringY - prevRingY;
      const speed = Math.sqrt(vx * vx + vy * vy);

      // Stretch ring along direction of movement
      // Max stretch ~1.4x at high speed, clamp gently
      const stretchFactor = Math.min(1 + speed * 0.06, 1.40);
      const angle = speed > 0.2 ? Math.atan2(vy, vx) * (180 / Math.PI) : 0;
      const squish = 1 / stretchFactor; // maintain area

      ring.style.transform =
        `translate(${ringX - RING_R}px, ${ringY - RING_R}px) ` +
        `rotate(${angle}deg) ` +
        `scaleX(${stretchFactor}) scaleY(${squish})`;

      dot.style.transform = `translate(${dotX - DOT_R}px, ${dotY - DOT_R}px)`;

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }


  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════
  async function init() {
    // Liquid glass cursor
    initCursor();

    // Theme
    initTheme();
    el.themeToggle.addEventListener('click', toggleTheme);

    // Load & render
    history = await loadHistory();
    renderAll(history);

    // Export
    el.exportBtn.addEventListener('click', () => exportCSV(history));

    // Clear
    el.clearBtn.addEventListener('click', showClearModal);
    el.modalCancel.addEventListener('click', hideClearModal);
    el.modalConfirm.addEventListener('click', confirmClear);

    // Close modal on overlay click
    el.modalOverlay.addEventListener('click', (e) => {
      if (e.target === el.modalOverlay) hideClearModal();
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideClearModal();
    });

    // Live-update when storage changes (e.g., sidepanel completes a session)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['privsight-history']) {
        history = changes['privsight-history'].newValue || [];
        renderAll(history);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
