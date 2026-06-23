const net = require('net');
const { execSync } = require('child_process');
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

const AGENT_LOG = cfg.AGENT_LOG;
function log(msg) {
  try { fs.appendFileSync(AGENT_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch(e) {}
}

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

let reconnectAttempts = 0;
function connectToRelay() {
  if (relayConn) try { relayConn.end(); } catch(e) {}
  relayConn = new net.Socket();
  relayConn.setKeepAlive(true, 30000);
  relayConn.connect(cfg.RELAY_PORT, cfg.RELAY_IP, () => {
    reconnectAttempts = 0;
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
    const delay = Math.min(30000, 5000 * Math.pow(2, reconnectAttempts));
    reconnectAttempts++;
    setTimeout(connectToRelay, delay);
  });
  relayConn.on('error', () => {
    relayConn = null;
    setTimeout(connectToRelay, 5000);
  });
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
        const parts = (args || '').split('|');
        const dir = parts[0] || 'C:\\';
        const maxDepth = parseInt(parts[1]) || 5;
        result = buildTree(dir, 0, maxDepth);
        break;
      }
      case 'exec': {
        const out = execSync(args, { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
        result = out;
        break;
      }
      case 'listall': {
        const parts = (args || '').split('|');
        const dir = parts[0] || 'C:\\';
        const maxDepth = parseInt(parts[1]) || 10;
        const results = [];
        function walk(d, depth) {
          if (depth > maxDepth) return;
          try {
            const items = fs.readdirSync(d);
            for (const name of items) {
              const full = path.join(d, name);
              try {
                const stat = fs.statSync(full);
                results.push({
                  name, path: full, dir: stat.isDirectory(),
                  size: stat.isDirectory() ? 0 : stat.size,
                  mtime: stat.mtime.toISOString()
                });
                if (stat.isDirectory()) walk(full, depth + 1);
              } catch(e) {}
            }
          } catch(e) {}
        }
        walk(dir, 0);
        result = JSON.stringify(results, null, 2);
        break;
      }
      case 'dl': {
        const filePath = args;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) { result = 'Error: Cannot download a directory'; break; }
        if (stat.size > 50 * 1024 * 1024) { result = `Error: File too large (${Math.round(stat.size/1024/1024)}MB > 50MB limit)`; break; }
        const content = fs.readFileSync(filePath);
        result = JSON.stringify({
          name: path.basename(filePath),
          size: stat.size,
          data: content.toString('base64')
        });
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

function buildTree(dir, depth, maxDepth) {
  if (depth > (maxDepth || 4)) return '  '.repeat(depth) + '... (max depth)\n';
  let out = '';
  try {
    const items = fs.readdirSync(dir);
    for (const name of items) {
      const full = path.join(dir, name);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch(e) { continue; }
      out += '  '.repeat(depth) + (isDir ? '[DIR] ' : '[FIL] ') + name + '\n';
      if (isDir) out += buildTree(full, depth + 1, maxDepth);
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
