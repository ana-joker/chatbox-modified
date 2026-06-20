#!/usr/bin/env node
const net = require('net');
const PIPE = '\\\\.\\pipe\\albedo-chat-bridge';
const msg = process.argv[2] || 'Hello from Chatbox Modified';

const client = new net.Socket();
client.connect(PIPE, () => {
  const req = JSON.stringify({ type: 'message', data: msg, from: 'chatbox', ts: Date.now() }) + '\n';
  client.write(req);
  client.end();
  process.exit(0);
});
client.on('error', (err) => {
  console.error('Bridge not available:', err.message);
  process.exit(1);
});
