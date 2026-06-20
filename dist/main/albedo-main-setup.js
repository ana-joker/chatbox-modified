const { ipcMain, BrowserWindow, app } = require('electron');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PIPE = '\\\\.\\pipe\\albedo-chat-bridge';
const BRIDGE_SCRIPT = path.join(__dirname, 'albedo-bridge.js');

let bridgeProc = null;
let pipeConn = null;
let reconnectTimer = null;
let pipeBuf = '';

function connect() {
  if (pipeConn) { try { pipeConn.end(); } catch(e) {} pipeConn = null; }
  pipeConn = new net.Socket();
  pipeConn.connect(PIPE, () => {
    console.log('[Albedo] Bridge connected');
    pipeBuf = '';
  });
  pipeConn.on('data', (d) => {
    pipeBuf += d.toString();
    const parts = pipeBuf.split('\n');
    pipeBuf = parts.pop();
    for (const p of parts) {
      if (!p.trim()) continue;
      try {
        const msg = JSON.parse(p);
        BrowserWindow.getAllWindows().forEach(win => {
          win.webContents.send('albedo:receive', msg);
        });
      } catch(e) {}
    }
  });
  pipeConn.on('close', () => {
    pipeConn = null;
    reconnectTimer = setTimeout(connect, 2000);
  });
  pipeConn.on('error', () => { pipeConn = null; });
}

function startBridge() {
  if (bridgeProc) return;
  try {
    bridgeProc = spawn('node', [BRIDGE_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'], detached: true,
      cwd: path.dirname(BRIDGE_SCRIPT)
    });
    bridgeProc.unref();
    bridgeProc.stdout.on('data', d => console.log(`[Bridge] ${d}`));
    bridgeProc.stderr.on('data', d => console.error(`[Bridge-ERR] ${d}`));
    bridgeProc.on('exit', (c) => { bridgeProc = null; });
    setTimeout(connect, 2000);
  } catch(e) {
    console.error('[Albedo] Bridge start failed:', e.message);
    setTimeout(startBridge, 5000);
  }
}

ipcMain.handle('albedo:query', async (event, query) => {
  return new Promise((resolve) => {
    if (!pipeConn || !pipeConn.writable) return resolve({ error: 'Bridge disconnected' });
    const id = Date.now();
    pipeConn.write(JSON.stringify({ id, type: 'query', query }) + '\n');
    resolve({ id, status: 'submitted' });
  });
});

ipcMain.handle('albedo:web-search', async (event, query) => {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const path = require('path');
    const scriptPath = path.join(__dirname, 'albedo-search.py');
    const proc = spawn('python', [scriptPath, query]);
    let output = '';
    let errOutput = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { errOutput += d.toString(); });
    proc.on('close', () => {
      if (errOutput.trim()) {
        console.error(`[Albedo-Search-Error] Query "${query}":`, errOutput);
      }
      try {
        const results = JSON.parse(output);
        resolve(results);
      } catch(e) {
        resolve([]);
      }
    });
  });
});


ipcMain.on('albedo:send', (event, msg) => {
  if (pipeConn && pipeConn.writable) {
    pipeConn.write(JSON.stringify({ type: 'message', data: msg, from: 'chatbox' }) + '\n');
  }
});

app.on('ready', () => setTimeout(startBridge, 3000));

app.on('before-quit', () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (bridgeProc) { bridgeProc.kill(); bridgeProc = null; }
  if (pipeConn) { try { pipeConn.end(); } catch(e) {} pipeConn = null; }
});
