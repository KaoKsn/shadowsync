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

  // ── Data type config — unified cohesive blue theme ───
  const DATA_TYPES = [
    { key: 'email',      label: 'Email Addresses', color: '#38bdf8' },  // electric cyan
    { key: 'phone',      label: 'Phone Numbers',   color: '#0284c7' },  // deep cerulean
    { key: 'creditCard', label: 'Credit Cards',    color: '#60a5fa' },  // soft steel blue
    { key: 'password',   label: 'Passwords',       color: '#0ea5e9' },  // vibrant sky
    { key: 'ssn',        label: 'SSN / Gov IDs',   color: '#2563eb' },  // cobalt blue
    { key: 'other',      label: 'Other',           color: '#7dd3fc' },  // ice blue
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
    document.documentElement.setAttribute('data-theme', 'dark');
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
  async function init() {
    // Theme
    initTheme();

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
