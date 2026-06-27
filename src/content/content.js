/**
 * Motrix+ Content Script
 * Intercepts download links and shows in-page options overlay
 */

let overlayEl = null;
let pendingUrl = null;

// ─── Listen for messages from background ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SHOW_DOWNLOAD_OPTIONS') {
    showOverlay(msg.url);
  }
});

// ─── Overlay UI ───────────────────────────────────────────────────────────────

function showOverlay(url) {
  pendingUrl = url;
  removeOverlay();

  overlayEl = document.createElement('div');
  overlayEl.id = 'motrixplus-overlay';
  overlayEl.innerHTML = `
    <style>
      #motrixplus-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(0,0,0,0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      #motrixplus-card {
        background: #ffffff;
        border-radius: 14px;
        padding: 28px 32px;
        width: 420px;
        max-width: 90vw;
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        position: relative;
      }
      #motrixplus-card h2 {
        margin: 0 0 6px;
        font-size: 17px;
        font-weight: 600;
        color: #111;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #motrixplus-card .mp-logo {
        width: 28px;
        height: 28px;
        background: linear-gradient(135deg, #0057FF 0%, #00C2FF 100%);
        border-radius: 7px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 14px;
        font-weight: 700;
        flex-shrink: 0;
      }
      #motrixplus-card .mp-url {
        font-size: 12px;
        color: #888;
        word-break: break-all;
        margin: 0 0 20px;
        padding: 8px 10px;
        background: #f5f5f5;
        border-radius: 7px;
      }
      #motrixplus-card label {
        display: block;
        font-size: 12px;
        font-weight: 500;
        color: #555;
        margin-bottom: 4px;
      }
      #motrixplus-card input[type="text"] {
        width: 100%;
        box-sizing: border-box;
        padding: 9px 11px;
        border: 1px solid #ddd;
        border-radius: 7px;
        font-size: 13px;
        margin-bottom: 14px;
        outline: none;
        transition: border-color 0.15s;
      }
      #motrixplus-card input[type="text"]:focus {
        border-color: #0057FF;
      }
      #motrixplus-card .mp-row {
        display: flex;
        gap: 10px;
        margin-bottom: 14px;
      }
      #motrixplus-card .mp-row input {
        flex: 1;
        padding: 9px 11px;
        border: 1px solid #ddd;
        border-radius: 7px;
        font-size: 13px;
        outline: none;
      }
      #motrixplus-card .mp-row input:focus { border-color: #0057FF; }
      #motrixplus-card .mp-actions {
        display: flex;
        gap: 8px;
        margin-top: 4px;
      }
      #motrixplus-card button {
        flex: 1;
        padding: 10px;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.15s, transform 0.1s;
      }
      #motrixplus-card button:active { transform: scale(0.98); }
      #motrixplus-card .btn-primary {
        background: #0057FF;
        color: #fff;
      }
      #motrixplus-card .btn-primary:hover { background: #0047e0; }
      #motrixplus-card .btn-cancel {
        background: #f0f0f0;
        color: #444;
      }
      #motrixplus-card .btn-cancel:hover { background: #e5e5e5; }
      #motrixplus-card .mp-close {
        position: absolute;
        top: 14px;
        right: 14px;
        width: 28px;
        height: 28px;
        border: none;
        background: #f0f0f0;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        line-height: 28px;
        text-align: center;
        color: #666;
        flex: none;
      }
    </style>
    <div id="motrixplus-card" role="dialog" aria-modal="true" aria-label="Download with Motrix+">
      <button class="mp-close" aria-label="Close" id="mp-close">×</button>
      <h2><span class="mp-logo">M+</span> Download with Motrix+</h2>
      <div class="mp-url">${escapeHtml(url)}</div>
      <label for="mp-filename">Filename</label>
      <input type="text" id="mp-filename" placeholder="Leave blank to auto-detect" />
      <label for="mp-dir">Save to</label>
      <input type="text" id="mp-dir" placeholder="Default download directory" />
      <div class="mp-row">
        <input type="text" id="mp-referer" placeholder="Referer (optional)" />
        <input type="text" id="mp-cookies" placeholder="Cookies (optional)" />
      </div>
      <div class="mp-actions">
        <button class="btn-cancel" id="mp-cancel">Cancel</button>
        <button class="btn-primary" id="mp-download">Download</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlayEl);

  overlayEl.querySelector('#mp-close').addEventListener('click', removeOverlay);
  overlayEl.querySelector('#mp-cancel').addEventListener('click', removeOverlay);
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) removeOverlay();
  });
  overlayEl.querySelector('#mp-download').addEventListener('click', () => {
    const filename = overlayEl.querySelector('#mp-filename').value.trim();
    const dir = overlayEl.querySelector('#mp-dir').value.trim();
    const referer = overlayEl.querySelector('#mp-referer').value.trim();
    const cookies = overlayEl.querySelector('#mp-cookies').value.trim();

    chrome.runtime.sendMessage({
      type: 'ADD_DOWNLOAD',
      url: pendingUrl,
      options: { filename: filename || undefined, dir: dir || undefined, referer: referer || undefined, cookies: cookies || undefined },
    });
    removeOverlay();
  });

  // Focus first input
  setTimeout(() => overlayEl.querySelector('#mp-filename').focus(), 50);

  document.addEventListener('keydown', onEsc);
}

function removeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  document.removeEventListener('keydown', onEsc);
}

function onEsc(e) {
  if (e.key === 'Escape') removeOverlay();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─── Smart link detection ─────────────────────────────────────────────────────

const DOWNLOAD_EXTENSIONS = /\.(zip|rar|7z|tar|gz|iso|dmg|exe|msi|deb|rpm|pkg|apk|pdf|torrent|mp4|mkv|avi|mov|flv|mp3|flac|wav|ogg)(\?.*)?$/i;

document.addEventListener('click', (e) => {
  const anchor = e.target.closest('a[href]');
  if (!anchor) return;
  const href = anchor.href;
  if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
  if (!DOWNLOAD_EXTENSIONS.test(href)) return;

  // Check if user wants to use Motrix+
  chrome.storage.sync.get({ interceptDownloads: true }, ({ interceptDownloads }) => {
    if (!interceptDownloads) return;
    // We let the background's download listener handle it — no need to intercept here
    // Just let the click proceed normally; background.js cancels and re-routes
  });
}, true);
