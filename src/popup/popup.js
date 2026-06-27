/**
 * Motrix+ Popup Script
 */

// ─── State ────────────────────────────────────────────────────────────────────

let currentTab = 'active';
let allTasks = [];
let settings = {};
let bwHistory = [];
let latencyHistory = [];
let chartCtx = null;
const BG = chrome.runtime;

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  chartCtx = document.getElementById('bw-chart').getContext('2d');
  resizeChart();

  setupTabs();
  setupAddButton();
  setupSettings();

  settings = await msg('GET_SETTINGS');
  applySettingsToForm();

  await msg('GET_STATUS');

  BG.onMessage.addListener((m) => {
    if (m.type === 'STATUS_UPDATE') handleStatusUpdate(m.payload);
  });
});

function resizeChart() {
  const canvas = document.getElementById('bw-chart');
  canvas.width = canvas.offsetWidth * devicePixelRatio;
  canvas.height = 48 * devicePixelRatio;
  canvas.style.height = '48px';
}

// ─── Messaging ────────────────────────────────────────────────────────────────

function msg(type, data = {}) {
  return new Promise(resolve => {
    BG.sendMessage({ type, ...data }, (res) => {
      if (BG.lastError) resolve(null);
      else resolve(res);
    });
  });
}

// ─── Status Update ────────────────────────────────────────────────────────────

function handleStatusUpdate(payload) {
  const dot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  if (payload.connected) {
    dot.className = 'status-dot connected';
    statusText.textContent = `aria2 ${payload.version || 'connected'}`;
  } else {
    dot.className = 'status-dot error';
    statusText.textContent = 'aria2 not connected — start aria2 first';
  }

  if (payload.latency !== undefined) {
    document.getElementById('metric-latency').textContent = `${payload.latency} ms`;
    document.getElementById('bw-latency').textContent = `${payload.latency} ms`;
    latencyHistory.push(payload.latency);
    if (latencyHistory.length > 30) latencyHistory.shift();
  }

  if (payload.bandwidth) {
    const bw = payload.bandwidth;
    document.getElementById('metric-speed').textContent = formatSpeed(bw.current);
    document.getElementById('bw-current').textContent = formatSpeed(bw.current);
    document.getElementById('bw-avg').textContent = formatSpeed(bw.average);
    document.getElementById('bw-stability').textContent = `${bw.stability}%`;

    if (bw.history) {
      bwHistory = bw.history.map(e => e.speed);
    }
    drawChart();
  }

  if (payload.tasks) {
    allTasks = payload.tasks;
    renderTasks();
  }
}

// ─── Bandwidth Chart ──────────────────────────────────────────────────────────

function drawChart() {
  const canvas = document.getElementById('bw-chart');
  const ctx = chartCtx;
  const dpr = devicePixelRatio;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const data = bwHistory.length > 0 ? bwHistory : [0];
  const max = Math.max(...data, 1024);
  const points = data.slice(-40);
  const step = w / Math.max(points.length - 1, 1);

  // Grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = dpr * 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (points.length < 2) return;

  // Area fill
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,87,255,0.18)');
  grad.addColorStop(1, 'rgba(0,87,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < points.length; i++) {
    const x = i * step;
    const y = h - (points[i] / max) * (h - dpr * 4) - dpr * 2;
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo((points.length - 1) * step, h);
  ctx.closePath();
  ctx.fill();

  // Line
  ctx.strokeStyle = '#0057FF';
  ctx.lineWidth = dpr * 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = i * step;
    const y = h - (points[i] / max) * (h - dpr * 4) - dpr * 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      currentTab = tab.dataset.tab;
      renderTasks();
    });
  });
}

// ─── Task Rendering ───────────────────────────────────────────────────────────

function renderTasks() {
  const list = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');

  const filtered = allTasks.filter(t => {
    if (currentTab === 'active') return t.status === 'active';
    if (currentTab === 'waiting') return t.status === 'waiting' || t.status === 'paused';
    if (currentTab === 'stopped') return t.status === 'complete' || t.status === 'error' || t.status === 'removed';
    return true;
  });

  // Remove old task items
  list.querySelectorAll('.task-item').forEach(el => el.remove());

  if (filtered.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  for (const task of filtered) {
    list.appendChild(createTaskEl(task));
  }
}

function createTaskEl(task) {
  const el = document.createElement('div');
  el.className = 'task-item';
  el.dataset.gid = task.gid;

  const isPaused = task.status === 'paused';
  const isActive = task.status === 'active';
  const isComplete = task.status === 'complete';
  const isError = task.status === 'error';
  const pct = Math.min(100, task.progress || 0);

  const barClass = isComplete ? 'complete' : isError ? 'error' : '';
  const badgeClass = isComplete ? 'complete' : isError ? 'error' : task.status;
  const badgeLabel = isComplete ? 'done' : isError ? 'error' : task.status;

  const speedInfo = isActive
    ? `<span class="task-speed">${formatSpeed(task.downloadSpeed)}</span> · `
    : '';
  const connInfo = isActive && task.connections > 0
    ? `<span class="task-connections">${task.connections} conn</span> · `
    : '';

  el.innerHTML = `
    <div class="task-top">
      <div class="task-icon">
        ${fileIcon(task.filename)}
      </div>
      <div class="task-meta">
        <div class="task-filename" title="${escapeHtml(task.filename)}">${escapeHtml(task.filename)}</div>
        <div class="task-status-row">
          <span class="status-badge ${badgeClass}">${badgeLabel}</span>
          ${speedInfo}${connInfo}
          <span class="task-size">${formatSize(task.completedLength)} / ${formatSize(task.totalLength)}</span>
        </div>
      </div>
      <div class="task-actions">
        <span class="task-pct">${pct}%</span>
        ${isActive || isPaused ? `
          <button class="task-btn btn-pause-resume" title="${isPaused ? 'Resume' : 'Pause'}" aria-label="${isPaused ? 'Resume' : 'Pause'}">
            ${isPaused ? playIcon() : pauseIcon()}
          </button>
        ` : ''}
        <button class="task-btn danger btn-remove" title="Remove" aria-label="Remove download">
          ${trashIcon()}
        </button>
      </div>
    </div>
    <div class="task-progress-wrap">
      <div class="task-progress-bar ${barClass}" style="width:${pct}%"></div>
    </div>
  `;

  el.querySelector('.btn-remove')?.addEventListener('click', async () => {
    await msg('REMOVE_DOWNLOAD', { gid: task.gid });
    await msg('GET_STATUS');
  });

  el.querySelector('.btn-pause-resume')?.addEventListener('click', async () => {
    if (isPaused) await msg('RESUME_DOWNLOAD', { gid: task.gid });
    else await msg('PAUSE_DOWNLOAD', { gid: task.gid });
    await msg('GET_STATUS');
  });

  return el;
}

// ─── Add Download ─────────────────────────────────────────────────────────────

function setupAddButton() {
  const input = document.getElementById('url-input');
  const btn = document.getElementById('btn-add');

  const doAdd = async () => {
    const url = input.value.trim();
    if (!url || !isValidUrl(url)) {
      input.style.borderColor = '#e53e3e';
      setTimeout(() => input.style.borderColor = '', 1200);
      return;
    }
    btn.textContent = '…';
    const res = await msg('ADD_DOWNLOAD', { url });
    if (res && !res.error) {
      input.value = '';
      await msg('GET_STATUS');
      // Switch to active tab
      document.querySelector('[data-tab="active"]').click();
    } else {
      input.style.borderColor = '#e53e3e';
      setTimeout(() => input.style.borderColor = '', 1500);
    }
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add`;
  };

  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });

  // Try to paste from clipboard on open
  navigator.clipboard?.readText().then(text => {
    if (text && isValidUrl(text) && !input.value) {
      input.value = text;
      input.select();
    }
  }).catch(() => {});
}

// ─── Settings ────────────────────────────────────────────────────────────────

function setupSettings() {
  const panel = document.getElementById('settings-panel');

  document.getElementById('btn-settings').addEventListener('click', () => {
    panel.classList.remove('hidden');
  });
  document.getElementById('btn-back').addEventListener('click', () => {
    panel.classList.add('hidden');
  });
  document.getElementById('btn-open-aria2').addEventListener('click', () => {
    chrome.tabs.create({ url: 'http://localhost:6800/' });
  });

  // Range display
  function syncRange(id, displayId, suffix = '') {
    const el = document.getElementById(id);
    const disp = document.getElementById(displayId);
    el.addEventListener('input', () => { disp.textContent = el.value + suffix; });
  }
  syncRange('s-connections', 's-connections-val');
  syncRange('s-splits', 's-splits-val');
  syncRange('s-concurrent', 's-concurrent-val');
  syncRange('s-intercept-size', 's-intercept-size-val', ' MB');

  // Speed limit toggle
  document.getElementById('s-speed-limit-en').addEventListener('change', (e) => {
    document.getElementById('speed-limit-row').style.display = e.target.checked ? 'flex' : 'none';
  });

  // Test connection
  document.getElementById('btn-test-conn').addEventListener('click', async () => {
    const result = document.getElementById('conn-result');
    result.textContent = 'Testing…';
    result.className = 'conn-result';
    const res = await msg('PING_ARIA2');
    if (res?.connected) {
      result.textContent = '✓ Connected to aria2';
      result.className = 'conn-result ok';
    } else {
      result.textContent = '✗ Could not reach aria2 — is it running?';
      result.className = 'conn-result fail';
    }
  });

  // Save
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const newSettings = readSettingsForm();
    await msg('SAVE_SETTINGS', { settings: newSettings });
    settings = newSettings;
    panel.classList.add('hidden');
  });
}

function applySettingsToForm() {
  if (!settings) return;
  setValue('s-rpc-url', settings.aria2RpcUrl || '');
  setValue('s-secret', settings.aria2Secret || '');
  setRange('s-connections', 's-connections-val', settings.maxConnections || 8);
  setRange('s-splits', 's-splits-val', settings.splitCount || 8);
  setRange('s-concurrent', 's-concurrent-val', settings.maxConcurrentDownloads || 5);
  setRange('s-intercept-size', 's-intercept-size-val', settings.interceptMinSizeMb || 10, ' MB');
  setCheck('s-bw-opt', settings.bandwidthOptimization !== false);
  setCheck('s-latency-opt', settings.latencyOptimization !== false);
  setCheck('s-speed-limit-en', !!settings.speedLimitEnabled);
  setCheck('s-intercept', settings.interceptDownloads !== false);
  setCheck('s-notif', settings.notificationsEnabled !== false);
  setValue('s-speed-limit', settings.speedLimitKbps || '');
  document.getElementById('speed-limit-row').style.display = settings.speedLimitEnabled ? 'flex' : 'none';
}

function readSettingsForm() {
  return {
    aria2RpcUrl: getVal('s-rpc-url') || 'http://localhost:16800/jsonrpc',
    aria2Secret: getVal('s-secret'),
    maxConnections: +getVal('s-connections'),
    splitCount: +getVal('s-splits'),
    maxConcurrentDownloads: +getVal('s-concurrent'),
    interceptMinSizeMb: +getVal('s-intercept-size'),
    bandwidthOptimization: getCheck('s-bw-opt'),
    latencyOptimization: getCheck('s-latency-opt'),
    speedLimitEnabled: getCheck('s-speed-limit-en'),
    speedLimitKbps: +getVal('s-speed-limit') || 0,
    interceptDownloads: getCheck('s-intercept'),
    notificationsEnabled: getCheck('s-notif'),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getVal(id) { return document.getElementById(id)?.value?.trim() || ''; }
function setCheck(id, val) { const el = document.getElementById(id); if (el) el.checked = val; }
function getCheck(id) { return !!document.getElementById(id)?.checked; }
function setRange(id, dispId, val, suffix = '') {
  const el = document.getElementById(id);
  const disp = document.getElementById(dispId);
  if (el) el.value = val;
  if (disp) disp.textContent = val + suffix;
}

function isValidUrl(s) {
  try { new URL(s); return true; } catch { return false; }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatSpeed(bps) {
  bps = bps || 0;
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`;
  if (bps < 1073741824) return `${(bps / 1048576).toFixed(2)} MB/s`;
  return `${(bps / 1073741824).toFixed(2)} GB/s`;
}

function formatSize(bytes) {
  bytes = bytes || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function fileIcon(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (['mp4', 'mkv', 'avi', 'mov', 'flv'].includes(ext))
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0057FF" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
  if (['mp3', 'flac', 'wav', 'ogg', 'aac'].includes(ext))
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0057FF" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0057FF" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`;
  if (ext === 'pdf')
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0057FF" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  if (ext === 'torrent')
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0057FF" stroke-width="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`;
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0057FF" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
}

function pauseIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
}
function playIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}
function trashIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
}
