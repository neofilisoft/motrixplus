# Motrix+ (Motrix Plus)

> A smart browser extension for managing downloads with stable bandwidth and latency optimization — built on top of [Motrix](https://github.com/agalwood/Motrix) and [aria2](https://aria2.github.io/).

---

## What is Motrix+?

Motrix+ is a **browser extension** (Chrome / Edge / Brave / Arc) that connects to a local [aria2](https://aria2.github.io/) RPC server to give you:

- 🚀 **Multi-connection downloading** — split files into up to 16 parallel streams
- 📊 **Live bandwidth monitoring** — real-time speed graph and stability score
- ⚡ **Smart bandwidth tuning** — auto-adjusts split count based on measured throughput
- 🎯 **Latency-aware optimization** — reduces overhead on high-latency connections
- 🔗 **Download interception** — transparently routes browser downloads through aria2
- 📋 **Clipboard URL detection** — auto-pastes links from clipboard on popup open
- 🖱️ **Right-click integration** — "Download with Motrix+" on any link
- 🔔 **Native notifications** — alerts on completion and errors
- ⚙️ **Full settings page** — speed limits, connection counts, user-agent, and more

---

## Requirements

- **aria2** running locally with RPC enabled
- Chrome, Edge, Brave, or any Chromium-based browser

---

## Quick start

### 1. Fork Motrix (optional, for desktop app)

```bash
git clone https://github.com/agalwood/Motrix.git motrix-plus-app
cd motrix-plus-app

# Rebrand: replace all "Motrix" with "Motrix+" in package.json and app files
sed -i 's/"name": "motrix"/"name": "motrix-plus"/g' package.json

yarn install
yarn run dev
```

### 2. Start aria2 with RPC

```bash
# macOS / Linux
aria2c \
  --enable-rpc \
  --rpc-listen-all \
  --rpc-listen-port=16800 \
  --rpc-allow-origin-all \
  --dir="$HOME/Downloads" \
  --continue \
  --max-connection-per-server=16 \
  --split=8 \
  --daemon

# Windows (PowerShell)
aria2c.exe --enable-rpc --rpc-listen-port=16800 --rpc-allow-origin-all --dir="%USERPROFILE%\Downloads" --continue --daemon
```

Optional: add a secret token for security:
```bash
aria2c --enable-rpc --rpc-secret=mysecret --rpc-listen-port=16800 ...
```

### 3. Install the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `motrix-plus/` folder from this project
5. Click the Motrix+ icon in the toolbar

### 4. Configure

1. Click the M+ icon → Settings gear
2. Set your aria2 RPC URL (default: `http://localhost:16800/jsonrpc`)
3. Set your secret token if you configured one
4. Click **Test connection** — you should see "Connected"

---

## Extension features

### Popup (`src/popup/`)

| Feature | Description |
|---|---|
| **Live bandwidth chart** | Canvas-drawn real-time speed graph with history |
| **4 key metrics** | Current speed, average speed, stability %, latency |
| **Quick add** | Paste URL + press Enter or click Add |
| **Clipboard auto-detect** | Auto-fills URL input from clipboard on open |
| **Task list** | Active / Waiting / Stopped tabs with progress bars |
| **Task controls** | Pause, resume, remove per-download |
| **File type icons** | Smart icons for video, audio, archive, PDF, torrent |
| **Inline settings** | Full settings accessible without opening a tab |

### Settings page (`src/options/`)

| Section | Options |
|---|---|
| **Connection** | RPC URL, secret token, live stats tile |
| **Downloads** | Connections/server, splits/file, concurrent downloads, user agent |
| **Bandwidth** | Smart tuning, low-latency mode, speed limit (KB/s) |
| **Interception** | Auto-intercept toggle, minimum file size threshold |
| **Notifications** | Complete and error notification toggles |

### Background service (`src/background/background.js`)

- aria2 JSON-RPC bridge (addUri, pause, unpause, remove, tellStatus, tellActive)
- Bandwidth sampling + stability coefficient of variation calculation
- Latency measurement on every RPC round-trip
- Smart option builder (auto-scales split count from throughput history)
- `chrome.downloads` interceptor (cancels and re-routes to aria2)
- Context menu: "Download with Motrix+" + "Download with Motrix+ (options)"
- Polling alarm every 5 seconds
- Chrome notifications on complete / error

### Content script (`src/content/content.js`)

- In-page download options overlay (filename, save directory, referer, cookies)
- Download link extension detection for right-click interception

---

## Architecture

```
motrix-plus/
├── manifest.json               # MV3 manifest
└── src/
    ├── background/
    │   └── background.js       # Service worker — aria2 RPC, bandwidth, interception
    ├── content/
    │   └── content.js          # In-page overlay, link detection
    ├── popup/
    │   ├── popup.html          # Extension popup shell
    │   ├── popup.css           # Motrix+ branded styles
    │   └── popup.js            # Popup logic, chart, task rendering
    ├── options/
    │   ├── options.html        # Full settings page
    │   └── options.js          # Options logic
    └── icons/
        ├── icon16.png
        ├── icon32.png
        ├── icon48.png
        └── icon128.png
```

---

## Bandwidth optimization algorithm

Motrix+ continuously measures download speed across a sliding window of 10 samples. When adding a new download:

| Measured average speed | Applied strategy |
|---|---|
| > 50 MB/s | Maximum parallel: 16 splits, 16 conn/server |
| 1–50 MB/s | Default settings (from user preferences) |
| < 1 MB/s | Conservative: 4 splits, 4 conn/server (avoid TCP overhead) |

The **stability score** is calculated as:

```
stability = 100 - (standard_deviation / mean × 100)
```

A score near 100% means very consistent bandwidth; lower scores indicate congested or variable connections where reducing parallelism may help.

---

## Rebranding from Motrix

If you also want to rebrand the Motrix desktop app:

```bash
# 1. Clone Motrix
git clone https://github.com/agalwood/Motrix.git motrix-plus
cd motrix-plus

# 2. Update package.json
sed -i 's/"name": "motrix"/"name": "motrix-plus"/g' package.json
sed -i 's/"productName": "Motrix"/"productName": "Motrix+"/g' package.json

# 3. Update app title in renderer source
find src -name "*.js" -o -name "*.vue" | xargs sed -i 's/Motrix/Motrix+/g'

# 4. Replace app ID (important for updates/auto-update)
sed -i 's/net.agalwood.Motrix/app.motrixplus.native/g' package.json

# 5. Build
yarn install
yarn run build
```

---

## Credits

- [Motrix](https://github.com/agalwood/Motrix) by agalwood — MIT License
- [aria2](https://aria2.github.io/) — the underlying download engine
- Motrix+ extension by you — MIT License

---

## License

MIT — do whatever you want, keep the attribution.
