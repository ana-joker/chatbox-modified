#!node
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PIPE_NAME = '\\\\.\\pipe\\albedo-kb';
const KB_DIR = path.join(os.homedir(), '.config', 'opencode', 'akashic');
const RESPONSES = path.join(os.tmpdir(), 'albedo-kb');

if (!fs.existsSync(RESPONSES)) fs.mkdirSync(RESPONSES, { recursive: true });

function log(m) { console.log(`[KB] ${m}`); }

function handle(req) {
  if (req.type === 'ping') return { id: req.id, type: 'pong', ts: Date.now() };

  if (req.type === 'search') {
    const q = req.query?.toLowerCase() || '';
    const results = [];
    if (fs.existsSync(KB_DIR)) {
      const files = fs.readdirSync(KB_DIR).filter(f => f.endsWith('.md') || f.endsWith('.jsonl') || f.endsWith('.json'));
      for (const file of files) {
        const fp = path.join(KB_DIR, file);
        const stat = fs.statSync(fp);
        if (q) {
          const content = fs.readFileSync(fp, 'utf-8');
          if (content.toLowerCase().includes(q)) {
            results.push({ file, size: stat.size, mtime: stat.mtime.toISOString() });
          }
        } else {
          results.push({ file, size: stat.size, mtime: stat.mtime.toISOString() });
        }
      }
    }
    return { id: req.id, type: 'search_result', results };
  }

  return { id: req.id, type: 'error', message: `Unknown: ${req.type}` };
}

const server = net.createServer(c => {
  let buf = '';
  c.on('data', d => {
    buf += d.toString();
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const p of parts) {
      if (!p.trim()) continue;
      try {
        c.write(JSON.stringify(handle(JSON.parse(p))) + '\n');
      } catch (e) {
        c.write(JSON.stringify({ type: 'error', message: e.message }) + '\n');
      }
    }
  });
});

server.listen(PIPE_NAME, () => log(`KB server on ${PIPE_NAME}`));
