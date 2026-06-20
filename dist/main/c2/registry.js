const machines = new Map();

function upsert(id, data) {
  const existing = machines.get(id) || {};
  const updated = { ...existing, ...data, lastSeen: Date.now() };
  machines.set(id, updated);
  return updated;
}

function remove(id) {
  machines.delete(id);
}

function get(id) {
  return machines.get(id);
}

function list() {
  return Array.from(machines.entries()).map(([id, data]) => ({ id, ...data }));
}

function online() {
  const now = Date.now();
  return list().filter(m => (now - (m.lastSeen || 0)) < 300000);
}

function offline() {
  const now = Date.now();
  return list().filter(m => (now - (m.lastSeen || 0)) >= 300000);
}

module.exports = { upsert, remove, get, list, online, offline };
