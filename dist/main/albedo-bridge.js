#!node
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PIPE_NAME = '\\\\.\\pipe\\albedo-chat-bridge';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');
const RESPONSE_DIR = path.join(os.tmpdir(), 'albedo-bridge');
const WAL_PATH = path.join(os.tmpdir(), 'albedo-bridge-wal.jsonl');

if (!fs.existsSync(RESPONSE_DIR)) fs.mkdirSync(RESPONSE_DIR, { recursive: true });

let reqId = 0;
const clients = new Set();

function wal(entry) {
  try { fs.appendFileSync(WAL_PATH, JSON.stringify(entry) + '\n'); } catch(e) {}
}

function broadcast(msg, exclude) {
  for (const c of clients) {
    if (c !== exclude && c.writable) {
      try { c.write(JSON.stringify(msg) + '\n'); } catch(e) {}
    }
  }
}

function handle(req, conn) {
  const id = ++reqId;

  if (req.type === 'ping') return { id, type: 'pong', ts: Date.now(), version: '1.2.0' };

  if (req.type === 'message') {
    wal({ action: 'message', from: req.from || 'unknown', data: req.data, ts: Date.now() });
    broadcast({ id, type: 'message', from: req.from || 'opencode', data: req.data, ts: Date.now() }, conn);
    return { id, type: 'message_forwarded' };
  }

  if (req.type === 'query') {
    const rf = path.join(RESPONSE_DIR, `q-${id}.json`);
    fs.writeFileSync(rf, JSON.stringify({ id, query: req.query, context: req.context || '', ts: Date.now() }));
    wal({ action: 'query', id, query: req.query, ts: Date.now() });
    return { id, type: 'query_submitted', status: 'pending' };
  }

  if (req.type === 'resp') {
    const qf = path.join(RESPONSE_DIR, `q-${req.qid}-resp.json`);
    fs.writeFileSync(qf, JSON.stringify({ qid: req.qid, response: req.data, ts: Date.now() }));
    broadcast({ id, type: 'response', qid: req.qid, data: req.data }, conn);
    return { id, type: 'response_stored' };
  }

  if (req.type === 'poll') {
    const qf = path.join(RESPONSE_DIR, `q-${req.qid}-resp.json`);
    if (fs.existsSync(qf)) {
      try {
        const d = JSON.parse(fs.readFileSync(qf, 'utf-8'));
        fs.unlinkSync(qf);
        return { id, type: 'response', qid: req.qid, data: d.response };
      } catch(e) { return { id, type: 'poll_error', error: e.message }; }
    }
    return { id, type: 'no_response', qid: req.qid };
  }

  return { id, type: 'error', message: `Unknown: ${req.type}` };
}

const server = net.createServer((conn) => {
  clients.add(conn);
  let buf = '';
  conn.on('data', (d) => {
    buf += d.toString();
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const p of parts) {
      if (!p.trim()) continue;
      try {
        const req = JSON.parse(p);
        const resp = handle(req, conn);
        if (conn.writable) conn.write(JSON.stringify(resp) + '\n');
      } catch(e) {
        if (conn.writable) conn.write(JSON.stringify({ type: 'error', message: e.message }) + '\n');
      }
    }
  });
  conn.on('close', () => clients.delete(conn));
  conn.on('error', () => clients.delete(conn));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    setTimeout(() => { server.close(); server.listen(PIPE_NAME); }, 3000);
  }
});

server.listen(PIPE_NAME, () => {
  console.log(`[ALBEDO-BRIDGE] Listening on ${PIPE_NAME}`);
  wal({ action: 'start', ts: Date.now() });
});
