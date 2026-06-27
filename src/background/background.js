/**
 * Motrix+ Background Service Worker
 * Manages downloads, bandwidth optimization, aria2 RPC, and smart scheduling
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const ARIA2_RPC_URL = 'http://localhost:16800/jsonrpc';
const ARIA2_SECRET = '';
const PING_INTERVAL = 5; // seconds
const BANDWIDTH_SAMPLE_WINDOW = 10; // samples to keep
const MAX_CONNECTIONS = 16;

// ─── State ────────────────────────────────────────────────────────────────────

let rpcId = 1;
let isAria2Connected = false;
let bandwidthHistory = [];
let latencyHistory = [];
let activeDownloads = new Map(); // gid → download info
let downloadQueue = [];
let settings = {};

// ─── Initialization ────────────────────────────────────────────────────────────

async function init() {
  settings = await loadSettings();
  setupContextMenu();
  setupAlarms();
  setupDownloadInterceptor();
  await pingAria2();
  console.log('[Motrix+] Background service worker ready');
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get({
      aria2RpcUrl: ARIA2_RPC_URL,
      aria2Secret: ARIA2_SECRET,
      maxConnections: 8,
      maxConcurrentDownloads: 5,
      speedLimitEnabled: false,
      speedLimitKbps: 0,
      bandwidthOptimization: true,
      latencyOptimization: true,
      autoSchedule: false,
      scheduleStartHour: 0,
      scheduleEndHour: 6,
      interceptDownloads: true,
      interceptMinSizeMb: 10,
      notificationsEnabled: true,
      splitCount: 8,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }, resolve);
  });
}

async function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  return new Promise(resolve => {
    chrome.storage.sync.set(settings, resolve);
  });
}

// ─── aria2 RPC ────────────────────────────────────────────────────────────────

async function rpcCall(method, params = []) {
  const id = rpcId++;
  const body = {
    jsonrpc: '2.0',
    id,
    method,
    params: settings.aria2Secret
      ? [`token:${settings.aria2Secret}`, ...params]
      : params,
  };
  try {
    const res = await fetch(settings.aria2RpcUrl || ARIA2_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  } catch (err) {
    return null;
  }
}

async function pingAria2() {
  const t0 = performance.now();
  const result = await rpcCall('aria2.getVersion');
  const latency = Math.round(performance.now() - t0);

  if (result) {
    isAria2Connected = true;
    recordLatency(latency);
    broadcastStatus({ connected: true, version: result.version, latency });
  } else {
    isAria2Connected = false;
    broadcastStatus({ connected: false });
  }
  return isAria2Connected;
}

// ─── Download Management ──────────────────────────────────────────────────────

async function addDownload(url, options = {}) {
  if (!isAria2Connected) {
    return { error: 'aria2 not connected', url };
  }

  const mergedOptions = buildAria2Options(url, options);
  const gid = await rpcCall('aria2.addUri', [[url], mergedOptions]);
  if (!gid) return { error: 'Failed to add download', url };

  const download = {
    gid,
    url,
    filename: options.filename || extractFilename(url),
    status: 'waiting',
    progress: 0,
    speed: 0,
    totalLength: 0,
    completedLength: 0,
    addedAt: Date.now(),
    options,
  };

  activeDownloads.set(gid, download);
  saveDownloadsToStorage();

  if (settings.notificationsEnabled) {
    notify('Download queued', `${download.filename}`);
  }

  return { gid, ...download };
}

function buildAria2Options(url, options = {}) {
  const opts = {
    'split': String(settings.splitCount || 8),
    'max-connection-per-server': String(Math.min(settings.maxConnections || 8, 16)),
    'min-split-size': '1M',
    'user-agent': settings.userAgent,
    'continue': 'true',
  };

  if (options.dir) opts['dir'] = options.dir;
  if (options.filename) opts['out'] = options.filename;
  if (options.referer) opts['referer'] = options.referer;
  if (options.cookies) opts['header'] = [`Cookie: ${options.cookies}`];

  // Bandwidth optimization: tune split count based on recent speed
  if (settings.bandwidthOptimization && bandwidthHistory.length > 3) {
    const avgSpeed = averageBandwidth();
    if (avgSpeed > 50000) {
      // > 50 MB/s — maximize parallel splits
      opts['split'] = '16';
      opts['max-connection-per-server'] = '16';
    } else if (avgSpeed < 1000) {
      // < 1 MB/s — reduce parallelism to avoid overhead
      opts['split'] = '4';
      opts['max-connection-per-server'] = '4';
    }
  }

  // Speed limit
  if (settings.speedLimitEnabled && settings.speedLimitKbps > 0) {
    opts['max-download-limit'] = `${settings.speedLimitKbps}K`;
  }

  return opts;
}

async function pauseDownload(gid) {
  return await rpcCall('aria2.pause', [gid]);
}

async function resumeDownload(gid) {
  return await rpcCall('aria2.unpause', [gid]);
}

async function removeDownload(gid) {
  await rpcCall('aria2.remove', [gid]);
  activeDownloads.delete(gid);
  saveDownloadsToStorage();
}

async function getDownloadStatus(gid) {
  return await rpcCall('aria2.tellStatus', [gid, [
    'gid', 'status', 'totalLength', 'completedLength',
    'downloadSpeed', 'uploadSpeed', 'errorCode', 'errorMessage',
    'files', 'connections', 'pieceLength', 'numPieces',
  ]]);
}

async function getAllActive() {
  return await rpcCall('aria2.tellActive', []);
}

async function getAllWaiting() {
  return await rpcCall('aria2.tellWaiting', [0, 100]);
}

async function getAllStopped() {
  return await rpcCall('aria2.tellStopped', [0, 100]);
}

// ─── Bandwidth & Latency Monitoring ──────────────────────────────────────────

function recordBandwidth(speedBps) {
  bandwidthHistory.push({ speed: speedBps, ts: Date.now() });
  if (bandwidthHistory.length > BANDWIDTH_SAMPLE_WINDOW) {
    bandwidthHistory.shift();
  }
}

function recordLatency(ms) {
  latencyHistory.push({ latency: ms, ts: Date.now() });
  if (latencyHistory.length > BANDWIDTH_SAMPLE_WINDOW) {
    latencyHistory.shift();
  }
}

function averageBandwidth() {
  if (bandwidthHistory.length === 0) return 0;
  return bandwidthHistory.reduce((s, e) => s + e.speed, 0) / bandwidthHistory.length;
}

function averageLatency() {
  if (latencyHistory.length === 0) return 0;
  return latencyHistory.reduce((s, e) => s + e.latency, 0) / latencyHistory.length;
}

function getBandwidthStability() {
  if (bandwidthHistory.length < 3) return 100;
  const speeds = bandwidthHistory.map(e => e.speed);
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  const variance = speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length;
  const cv = mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0;
  return Math.max(0, Math.round(100 - cv));
}

// ─── Polling Loop ─────────────────────────────────────────────────────────────

async function pollDownloads() {
  if (!isAria2Connected) {
    await pingAria2();
    return;
  }

  const t0 = performance.now();
  const [active, waiting, stopped] = await Promise.all([
    getAllActive(),
    getAllWaiting(),
    getAllStopped(),
  ]);
  const latency = Math.round(performance.now() - t0);
  recordLatency(latency);

  let totalSpeed = 0;
  const allTasks = [];

  if (active) {
    for (const task of active) {
      totalSpeed += parseInt(task.downloadSpeed || '0', 10);
      allTasks.push(normalizeTask(task, 'active'));
    }
  }
  if (waiting) {
    for (const task of waiting) {
      allTasks.push(normalizeTask(task, 'waiting'));
    }
  }
  if (stopped) {
    for (const task of stopped) {
      allTasks.push(normalizeTask(task, 'stopped'));
    }
  }

  recordBandwidth(totalSpeed);

  broadcastStatus({
    connected: true,
    latency,
    bandwidth: {
      current: totalSpeed,
      average: Math.round(averageBandwidth()),
      stability: getBandwidthStability(),
      history: bandwidthHistory.slice(-20),
    },
    tasks: allTasks,
  });

  // Check for completed tasks and notify
  for (const task of stopped || []) {
    if (task.status === 'complete') {
      const prev = activeDownloads.get(task.gid);
      if (prev && prev.status !== 'complete') {
        if (settings.notificationsEnabled) {
          notify('Download complete', getTaskFilename(task));
        }
      }
    }
  }

  // Update local cache
  for (const task of allTasks) {
    activeDownloads.set(task.gid, task);
  }
  saveDownloadsToStorage();
}

function normalizeTask(raw, statusHint) {
  const total = parseInt(raw.totalLength || '0', 10);
  const completed = parseInt(raw.completedLength || '0', 10);
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  return {
    gid: raw.gid,
    status: raw.status || statusHint,
    filename: getTaskFilename(raw),
    totalLength: total,
    completedLength: completed,
    downloadSpeed: parseInt(raw.downloadSpeed || '0', 10),
    uploadSpeed: parseInt(raw.uploadSpeed || '0', 10),
    connections: parseInt(raw.connections || '0', 10),
    progress,
    errorCode: raw.errorCode,
    errorMessage: raw.errorMessage,
  };
}

function getTaskFilename(task) {
  if (task.files && task.files[0] && task.files[0].path) {
    return task.files[0].path.split('/').pop() || task.gid;
  }
  return task.gid;
}

// ─── Download Interceptor ─────────────────────────────────────────────────────

function setupDownloadInterceptor() {
  chrome.downloads.onCreated.addListener(async (item) => {
    if (!settings.interceptDownloads) return;
    const minBytes = (settings.interceptMinSizeMb || 10) * 1024 * 1024;
    if (item.fileSize > 0 && item.fileSize < minBytes) return;

    // Cancel native download and redirect to aria2
    chrome.downloads.cancel(item.id, async () => {
      if (isAria2Connected) {
        await addDownload(item.url, {
          filename: item.filename?.split('/').pop() || item.filename?.split('\\').pop(),
          referer: item.referrer,
        });
      }
    });
  });
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'motrixplus-download',
      title: 'Download with Motrix+',
      contexts: ['link', 'image', 'video', 'audio'],
    });
    chrome.contextMenus.create({
      id: 'motrixplus-download-options',
      title: 'Download with Motrix+ (options)',
      contexts: ['link', 'image', 'video', 'audio'],
    });
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const url = info.linkUrl || info.srcUrl;
    if (!url) return;

    if (info.menuItemId === 'motrixplus-download') {
      await addDownload(url, { referer: tab?.url });
    } else if (info.menuItemId === 'motrixplus-download-options') {
      chrome.tabs.sendMessage(tab.id, { type: 'SHOW_DOWNLOAD_OPTIONS', url });
    }
  });
}

// ─── Alarms ───────────────────────────────────────────────────────────────────

function setupAlarms() {
  chrome.alarms.create('poll', { periodInMinutes: PING_INTERVAL / 60 });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'poll') {
      await pollDownloads();
    }
  });
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveDownloadsToStorage() {
  const serializable = Object.fromEntries(activeDownloads);
  chrome.storage.local.set({ downloads: serializable });
}

// ─── Messaging ───────────────────────────────────────────────────────────────

function broadcastStatus(payload) {
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload }).catch(() => {});
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'src/icons/icon48.png',
    title: `Motrix+ — ${title}`,
    message,
    silent: false,
  });
}

function extractFilename(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    return decodeURIComponent(parts[parts.length - 1]) || 'download';
  } catch {
    return 'download';
  }
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'ADD_DOWNLOAD':
        sendResponse(await addDownload(msg.url, msg.options || {}));
        break;
      case 'PAUSE_DOWNLOAD':
        sendResponse(await pauseDownload(msg.gid));
        break;
      case 'RESUME_DOWNLOAD':
        sendResponse(await resumeDownload(msg.gid));
        break;
      case 'REMOVE_DOWNLOAD':
        sendResponse(await removeDownload(msg.gid));
        break;
      case 'GET_STATUS':
        await pollDownloads();
        sendResponse({ ok: true });
        break;
      case 'SAVE_SETTINGS':
        await saveSettings(msg.settings);
        sendResponse({ ok: true });
        break;
      case 'GET_SETTINGS':
        sendResponse(settings);
        break;
      case 'PING_ARIA2':
        sendResponse({ connected: await pingAria2() });
        break;
      case 'GET_STATS':
        sendResponse({
          bandwidth: {
            current: bandwidthHistory[bandwidthHistory.length - 1]?.speed || 0,
            average: Math.round(averageBandwidth()),
            stability: getBandwidthStability(),
            history: bandwidthHistory,
          },
          latency: {
            current: latencyHistory[latencyHistory.length - 1]?.latency || 0,
            average: Math.round(averageLatency()),
            history: latencyHistory,
          },
          connected: isAria2Connected,
        });
        break;
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  })();
  return true; // keep channel open for async
});

// ─── Boot ──────────────────────────────────────────────────────────────────────

init();
