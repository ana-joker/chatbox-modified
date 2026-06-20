# Chatbox Modified

> A fork of [Chatbox Community Edition](https://github.com/chatboxai/chatbox) — the same powerful AI client, enhanced with a theme engine, background animations, study tools, and IPC bridge capabilities.

## What is This?

This repository contains the **prebuilt, modified version** of Chatbox — an Electron-based desktop client for ChatGPT, Claude, Gemini, and other LLMs. The modifications are applied directly to the compiled app bundle (not the TypeScript source), adding visual customization, focus tools, and external communication capabilities.

## Modifications Summary

### 1. Theme Engine (6 Color Schemes)

Override Mantine CSS variables via `<html>` class switching to fully recolor the entire UI — not just the background canvas, but buttons, inputs, cards, modals, and all Mantine components.

| Theme | Vibe |
|-------|------|
| **Default** | Dark purple gradient |
| **Loki** | Green/gold, green-tinged dark |
| **Doctor** | Clean white/blue, clinical |
| **Aizen** | Warm brown/amber, elegant |
| **Sakura** | Pink, soft romantic |
| **OLED** | True black, max contrast |

Selection is persisted in `localStorage` under `albedo-theme`.

### 2. Background Animations (5 Engines + None)

A `<canvas>` overlay behind the app content provides animated backgrounds. Five distinct engines with real-time controls:

| Engine | Description |
|--------|-------------|
| **Particles** | Floating connected particles |
| **Matrix Rain** | Green raining characters |
| **Molecules** | Orbiting molecular structures |
| **Retro Grid** | 3D perspective grid lines |
| **Sakura Drift** | Falling cherry blossoms |

**Controls** (per engine): Speed slider, density/number slider, brightness/opacity slider.  
Settings saved to `localStorage` under `albedo-canvas`.

### 3. Study Module

A left-sliding drawer (`#albedo-study-panel`) with:

**Timer (4 modes):**
- Pomodoro (25 min work / 5 min break)
- Short Break (5 min)
- Long Break (15 min)
- Stopwatch (count up)

**Features:** SVG circular progress ring, session counter, quick presets (5/15/25/30/60 min), custom minute input, audio completion alert (three synthesized beeps via AudioContext — no external files).

**Music Player:**
- HTML5 `<audio>` player with playlist UI
- Multi-file selection, folder upload (`webkitdirectory`), drag-and-drop
- Shuffle toggle (Fisher-Yates algorithm)
- Repeat mode: All / One / None

### 4. Splash Screen

Custom animated gradient splash replacing the default loader, with radial ambient glow animation and full CSS transitions. Adapts to both light and dark themes.

### 5. IPC Bridge (Named Pipe)

A bidirectional JSON-packet bridge over Windows Named Pipes (`\\.\pipe\chatbox-bridge`) enables external processes to:

- Send queries and receive responses from the app
- Inject messages into the chat UI
- Submit search queries and retrieve results

The bridge server (`albedo-bridge.js`) runs as a child process spawned by the main Electron process (`albedo-main-setup.js`).

### 6. Web Search Integration

A Python script (`albedo-search.py`) provides web search via:
- **Primary:** DuckDuckGo (HTML scraping, no API key needed)
- **Fallback:** Google basic HTML search

Bound to the `albedo:web-search` IPC handler, exposed to the renderer for use within the app.

### 7. Knowledge Base Server

A secondary Named Pipe server (`\\.\pipe\albedo-kb`) provides file-based knowledge base search across markdown, JSON, and JSONL files. Designed for Akashic memory integration.

### 8. External Send CLI

A command-line tool (`albedo-send.js`) that sends messages into the app via the bridge:
```bash
node albedo-send.js "Hello from external script"
```

## How to Use

1. **Download** the official [Chatbox Community Edition](https://github.com/chatboxai/chatbox/releases) installer for your platform
2. **Replace** the `resources/app/` folder inside the Chatbox installation directory with the contents of this repository
3. **Launch** Chatbox as usual — the modifications are all client-side

### Prerequisites

- **Node.js** (for the bridge server — starts automatically; requires `node` on PATH)
- **Python 3** (for web search — optional, falls back gracefully)
- **Windows** (Named Pipes are platform-specific; canvas animations work on all OS)

## Files We Added

| File | Purpose |
|------|---------|
| `dist/main/albedo-bridge.js` | Named pipe bridge server (IPC for external tools) |
| `dist/main/albedo-kb-server.js` | Knowledge base search server |
| `dist/main/albedo-main-setup.js` | Electron main process integration for bridge + web search |
| `dist/main/albedo-search.py` | DuckDuckGo / Google web search script |
| `dist/main/albedo-send.js` | CLI tool to send messages via bridge |

## Files We Modified

| File | Change |
|------|--------|
| `dist/renderer/index.html` | Splash screen, theme engine JS/CSS, canvas animations, study drawer (timer + music player), search fetch interceptor |
| `package.json` | Rebranded to Chatbox Modified, cleaned metadata |

## Technology

- **Built on:** Chatbox Community Edition (GPL v3)
- **Canvas animations:** Pure Canvas 2D API, no libraries
- **Audio:** Web Audio API (no external audio assets)
- **Bridge:** Windows Named Pipes (`net` module)
- **Search:** Python 3 + BeautifulSoup + Requests
- **Theming:** CSS custom properties (`--mantine-color-*`) overrides

## License

Same as the original — [GPL v3](LICENSE). This is a modified fork of the [Chatbox Community Edition](https://github.com/chatboxai/chatbox).
