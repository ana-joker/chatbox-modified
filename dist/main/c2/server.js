const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

function startFileServer(ip, port) {
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url);
    const filePath = decodeURIComponent(parsed.pathname);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const items = fs.readdirSync(filePath).map(name => {
          const full = path.join(filePath, name);
          let isDir = false;
          try { isDir = fs.statSync(full).isDirectory(); } catch(e) {}
          return { name, dir: isDir, size: isDir ? 0 : (fs.statSync(full).size || 0) };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: filePath, items }, null, 2));
      } else {
        const stream = fs.createReadStream(filePath);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
          'Content-Length': stat.size,
        });
        stream.pipe(res);
      }
    } catch(e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  server.listen(port, ip, () => {});

  return server;
}

module.exports = { startFileServer };
