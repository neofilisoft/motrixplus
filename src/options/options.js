/**
 * Motrix+ Options Page
 */

const DEFAULTS = {
  aria2RpcUrl: 'http://localhost:16800/jsonrpc',
  aria2Secret: '',
  maxConnections: 8,
  splitCount: 8,
  maxConcurrentDownloads: 5,
  speedLimitEnabled: false,
  speedLimitKbps: 0,
  bandwidthOptimization: true,
  latencyOptimization: true,
  interceptDownloads: true,
  interceptMinSizeMb: 10,
  notificationsEnabled: true,
  notifyError: true,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

let settings = { ...DEFAULTS };

// ─── Load settings ────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, data => resolve(data));
  });
}

async function saveSettings(s) {
  return new Promise(resolve => {
    chrome.storage.sync.set(s, resolve);
  });
}

// ─── Apply to form ────────────────────────────────────────────────────────────

function applyToForm(s) {
  setVal('s-rpc-url', s.aria2RpcUrl || '');
  setVal('s-secret', s.aria2Secret || '');
  setRange('s-connections', 's-connections-val', s.maxConnections || 8);
  setRange('s-splits', 's-splits-val', s.splitCount || 8);
  setRange('s-concurrent', 's-concurrent-val', s.maxConcurrentDownloads || 5);
  setRange('s-intercept-size', 's-intercept-size-val', s.interceptMinSizeMb || 10, ' MB');
  setCheck('s-bw-opt', s.bandwidthOptimization !== false);
  setCheck('s-latency-opt', s.latencyOptimization !== false);
  setCheck('s-speed-limit-en', !!s.speedLimitEnabled);
  setCheck('s-intercept', s.interceptDownloads !== false);
  setCheck('s-notif-complete', s.notificationsEnabled !== false);
  setCheck('s-notif-error', s.notifyError !== false);
  setVal('s-speed-limit', s.speedLimitKbps || '');
  setVal('s-user-agent', s.userAgent || '');
  document.getElementById('speed-limit-field').style.display = s.speedLimitEnabled ? 'block' : 'none';
}

function readFromForm() {
  return {
    aria2RpcUrl: getVal('s-rpc-url') || DEFAULTS.aria2RpcUrl,
    aria2Secret: getVal('s-secret'),
    maxConnections: +getRange('s-connections'),
    splitCount: +getRange('s-splits'),
    maxConcurrentDownloads: +getRange('s-concurrent'),
    interceptMinSizeMb: +getRange('s-intercept-size'),
    bandwidthOptimization: getCheck('s-bw-opt'),
    latencyOptimization: getCheck('s-latency-opt'),
    speedLimitEnabled: getCheck('s-speed-limit-en'),
    speedLimitKbps: +getVal('s-speed-limit') || 0,
    interceptDownloads: getCheck('s-intercept'),
    notificationsEnabled: getCheck('s-notif-complete'),
    notifyError: getCheck('s-notif-error'),
    userAgent: getVal('s-user-agent') || DEFAULTS.userAgent,
  };
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function setupNav() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('section[id^="section-"]');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      const target = item.dataset.section;
      sections.forEach(s => {
        s.className = s.id === `section-${target}` ? 'section-visible' : 'section-hidden';
      });
    });
  });
}

// ─── Range syncing ────────────────────────────────────────────────────────────

function syncRanges() {
  [
    ['s-connections', 's-connections-val', ''],
    ['s-splits', 's-splits-val', ''],
    ['s-concurrent', 's-concurrent-val', ''],
    ['s-intercept-size', 's-intercept-size-val', ' MB'],
  ].forEach(([id, dispId, suffix]) => {
    const el = document.getElementById(id);
    const disp = document.getElementById(dispId);
    if (el && disp) {
      el.addEventListener('input', () => { disp.textContent = el.value + suffix; });
    }
  });

  document.getElementById('s-speed-limit-en')?.addEventListener('change', e => {
    document.getElementById('speed-limit-field').style.display = e.target.checked ? 'block' : 'none';
  });
}

// ─── Connection test ──────────────────────────────────────────────────────────

async function testConnection() {
  const resultEl = document.getElementById('conn-result');
  resultEl.textContent = 'Testing…';
  resultEl.className = 'conn-result';

  const url = getVal('s-rpc-url') || DEFAULTS.aria2RpcUrl;
  const secret = getVal('s-secret');

  try {
    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'aria2.getVersion',
        params: secret ? [`token:${secret}`] : [],
      }),
      signal: AbortSignal.timeout(4000),
    });
    const latency = Math.round(performance.now() - t0);
    const data = await res.json();
    if (data.result) {
      resultEl.textContent = `✓ Connected — aria2 ${data.result.version} (${latency}ms)`;
      resultEl.className = 'conn-result ok';
      document.getElementById('stat-status').textContent = 'Online';
      document.getElementById('stat-latency').textContent = `${latency} ms`;
      document.getElementById('stat-version').textContent = data.result.version;
      pollLiveStats();
    } else {
      resultEl.textContent = `✗ Auth failed — check your secret token`;
      resultEl.className = 'conn-result fail';
    }
  } catch (err) {
    resultEl.textContent = `✗ Could not connect — is aria2 running?`;
    resultEl.className = 'conn-result fail';
    document.getElementById('stat-status').textContent = 'Offline';
  }
}

async function pollLiveStats() {
  const url = getVal('s-rpc-url') || DEFAULTS.aria2RpcUrl;
  const secret = getVal('s-secret');
  try {
    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'aria2.getGlobalStat',
        params: secret ? [`token:${secret}`] : [],
      }),
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    const latency = Math.round(performance.now() - t0);
    if (data.result) {
      const speed = parseInt(data.result.downloadSpeed || '0', 10);
      document.getElementById('stat-speed').textContent = formatSpeed(speed);
      document.getElementById('stat-latency').textContent = `${latency} ms`;
    }
  } catch {}
}

// ─── Save & Reset ─────────────────────────────────────────────────────────────

async function doSave() {
  const s = readFromForm();
  await saveSettings(s);
  settings = s;
  // Tell background
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: s });
  // Show save msg
  const msg = document.getElementById('save-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
}

function doReset() {
  if (confirm('Reset all settings to defaults?')) {
    applyToForm(DEFAULTS);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function getVal(id) { return document.getElementById(id)?.value?.trim() || ''; }
function setCheck(id, v) { const el = document.getElementById(id); if (el) el.checked = v; }
function getCheck(id) { return !!document.getElementById(id)?.checked; }
function setRange(id, dispId, v, suffix = '') {
  const el = document.getElementById(id); if (el) el.value = v;
  const d = document.getElementById(dispId); if (d) d.textContent = v + suffix;
}
function getRange(id) { return document.getElementById(id)?.value || 0; }

function formatSpeed(bps) {
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1048576).toFixed(2)} MB/s`;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  settings = await loadSettings();
  applyToForm(settings);
  setupNav();
  syncRanges();

  document.getElementById('btn-test-conn').addEventListener('click', testConnection);
  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('btn-reset').addEventListener('click', doReset);

  // Auto-test on load
  setTimeout(testConnection, 300);
});
