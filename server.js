'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const ROOT = __dirname;
const MAX_MESSAGE = 8 * 1024;
const MAX_CHAT_LENGTH = 500;
const HEARTBEAT_MS = 25000;
const CLIENT_TIMEOUT_MS = 75000;
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const clients = new Map();
const waiting = [];
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/ice-config') {
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    const turnUrls = String(process.env.TURN_URLS || '').split(',').map(value => value.trim()).filter(Boolean);
    const turnUsername = process.env.TURN_USERNAME || '';
    const turnCredential = process.env.TURN_CREDENTIAL || '';
    if (turnUrls.length && turnUsername && turnCredential) {
      iceServers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(JSON.stringify({ iceServers }));
  }
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, '.' + requested);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': STATIC_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=(self)',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return socket.destroy();
  let parsed;
  try { parsed = new URL(origin); } catch { return socket.destroy(); }
  if (parsed.host !== host) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

function send(client, payload) {
  if (client && client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
}
function broadcastOnlineCount() {
  const onlineCount = [...clients.values()].filter(client => client.hasJoined && client.ws.readyState === WebSocket.OPEN && Date.now() - client.lastPongAt < CLIENT_TIMEOUT_MS).length;
  const payload = JSON.stringify({ type: 'online-count', count: onlineCount });
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(payload);
  }
}
function broadcastSearchingCount() {
  const payload = JSON.stringify({ type: 'searching-count', count: waiting.length });
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(payload);
  }
}
function removeFromQueue(id) {
  const index = waiting.indexOf(id);
  if (index !== -1) waiting.splice(index, 1);
}
function clearPartner(client, notify = true) {
  if (!client || !client.partnerId) return;
  const partner = clients.get(client.partnerId);
  client.partnerId = null;
  client.matchId = null;
  client.matchState = 'idle';
  if (partner && partner.partnerId === client.id) {
    partner.partnerId = null;
    partner.matchId = null;
    partner.matchState = 'idle';
    if (notify) send(partner, { type: 'partner-left' });
  }
}
function queueClient(client, force = false) {
  if (!client || !client.hasJoined || client.ws.readyState !== WebSocket.OPEN) return;
  if (client.matchState === 'matched' && !force) return;
  if (client.matchState === 'waiting' && !force) return;
  console.log('[matchmaking] queue request', { id: client.id, state: client.matchState, waiting: waiting.length, connected: clients.size });
  removeFromQueue(client.id);
  if (client.partnerId) clearPartner(client, true);
  client.matchState = 'idle';
  for (let i = waiting.length - 1; i >= 0; i--) {
    const candidate = clients.get(waiting[i]);
    if (!candidate || candidate.ws.readyState !== WebSocket.OPEN || candidate.partnerId || candidate.matchState !== 'waiting') {
      waiting.splice(i, 1);
    }
  }
  const blocked = client.blocked;
  const matchIndex = waiting.findIndex(id => {
    const candidate = clients.get(id);
    return candidate && !blocked.has(id) && !candidate.blocked.has(client.id);
  });
  if (matchIndex === -1) {
    waiting.push(client.id);
    client.matchState = 'waiting';
    console.log('[matchmaking] waiting', { id: client.id, queue: waiting.length });
    send(client, { type: 'searching' });
    broadcastSearchingCount();
    return;
  }
  const [partnerId] = waiting.splice(matchIndex, 1);
  broadcastSearchingCount();
  const partner = clients.get(partnerId);
  if (!partner) return queueClient(client);
  const initiator = Math.random() < 0.5 ? client : partner;
  console.log('[matchmaking] matched', { a: client.id, b: partner.id, waiting: waiting.length });
  client.partnerId = partner.id;
  partner.partnerId = client.id;
  client.matchState = 'matched';
  partner.matchState = 'matched';
  client.matchId = partner.matchId = crypto.randomUUID();
  send(client, { type: 'matched', initiator: initiator.id === client.id });
  send(partner, { type: 'matched', initiator: initiator.id === partner.id });
}
function closeClient(client) {
  if (!client || client.closed) return;
  client.closed = true;
  console.log('[websocket] closed', { id: client.id });
  removeFromQueue(client.id);
  clearPartner(client, true);
  clients.delete(client.id);
  broadcastOnlineCount();
  broadcastSearchingCount();
}
function validText(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

wss.on('connection', ws => {
  const client = {
    id: crypto.randomUUID(),
    ws,
    name: 'Gast',
    age: 0,
    partnerId: null,
    blocked: new Set(),
    hasJoined: false,
    matchState: 'idle',
    matchId: null,
    lastChatAt: 0,
    lastPongAt: Date.now(),
    closed: false
  };
  clients.set(client.id, client);
  console.log('[websocket] connected', { id: client.id, connected: clients.size });
  send(client, { type: 'ready', id: client.id });
  broadcastOnlineCount();

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    client.lastPongAt = Date.now();
  });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(client, { type: 'error', message: 'Ungültige Nachricht.' }); }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      if (client.hasJoined) {
        console.log('[websocket] duplicate join ignored', { id: client.id });
        return;
      }
      const name = String(msg.name || '').trim().slice(0, 20);
      const age = Number(msg.age);
      if (!name || !Number.isInteger(age) || age < 18 || age > 99 || msg.adultConfirmed !== true) {
        return send(client, { type: 'error', message: 'STRANGER ist nur für bestätigte Erwachsene ab 18 Jahren.' });
      }
      client.name = name.replace(/[<>]/g, '');
      client.age = age;
      client.hasJoined = true;
      client.lastPongAt = Date.now();
      console.log('[websocket] valid join', { id: client.id, age });
      broadcastOnlineCount();
      queueClient(client);
      return;
    }
    if (msg.type === 'next') {
      if (!client.name || client.age < 18) return;
      queueClient(client, true);
      return;
    }
    if (msg.type === 'leave') {
      removeFromQueue(client.id);
      clearPartner(client, true);
      client.matchState = 'idle';
      send(client, { type: 'left' });
      broadcastSearchingCount();
      return;
    }
    if (msg.type === 'chat') {
      if (!client.partnerId || !validText(msg.text, MAX_CHAT_LENGTH)) return;
      const now = Date.now();
      if (now - client.lastChatAt < 500) return;
      client.lastChatAt = now;
      const partner = clients.get(client.partnerId);
      if (partner) send(partner, { type: 'chat', text: msg.text, from: client.name });
      return;
    }
    if (msg.type === 'signal') {
      if (!client.partnerId || !msg.data || typeof msg.data !== 'object') return;
      const partner = clients.get(client.partnerId);
      if (partner) send(partner, { type: 'signal', data: msg.data });
      return;
    }
    if (msg.type === 'block') {
      if (!client.partnerId) return;
      const blockedId = client.partnerId;
      client.blocked.add(blockedId);
      clearPartner(client, true);
      send(client, { type: 'blocked' });
      queueClient(client);
      return;
    }
    if (msg.type === 'report') {
      if (!client.partnerId) return;
      const reportedId = client.partnerId;
      // Reports are deliberately not persisted with personal data in this prototype.
      console.warn('[moderation-report]', { reporter: client.id, reported: reportedId, at: new Date().toISOString() });
      clearPartner(client, true);
      send(client, { type: 'reported' });
      queueClient(client);
    }
  });

  ws.on('close', () => closeClient(client));
  ws.on('error', () => closeClient(client));
});

const heartbeat = setInterval(() => {
  const now = Date.now();
  for (const client of clients.values()) {
    const ws = client.ws;
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (now - client.lastPongAt > CLIENT_TIMEOUT_MS) {
      ws.terminate();
      continue;
    }
    ws.ping();
  }
  broadcastOnlineCount();
  broadcastSearchingCount();
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log('STRANGER server listening on ' + PORT);
});
