import { createServer } from 'node:http';
import { parse as parseUrl } from 'node:url';

const PORT = Number(process.env.MEETING_SIGNAL_PORT || process.env.PORT || 8787);
const HOST = process.env.MEETING_SIGNAL_HOST || '0.0.0.0';
const PEER_TTL_MS = 15_000;
const SIGNAL_TTL_MS = 120_000;

const rooms = new Map();
const users = new Map();
const tokens = new Map();

const nowIso = () => new Date().toISOString();
const randomToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const numericRoomId = (roomKey) => {
  const n = Number(roomKey);
  return Number.isFinite(n) ? n : 0;
};

const ensureRoom = (roomKey) => {
  let room = rooms.get(roomKey);
  if (!room) {
    room = {
      peers: new Map(),
      signals: [],
      nextPeerId: 1,
      nextSignalId: 1,
    };
    rooms.set(roomKey, room);
  }
  return room;
};

const cleanupRoom = (room) => {
  const now = Date.now();
  for (const [peerId, peer] of room.peers.entries()) {
    if (now - Date.parse(peer.last_seen_at) > PEER_TTL_MS) {
      room.peers.delete(peerId);
    }
  }
  room.signals = room.signals.filter((signal) => now - Date.parse(signal.created_at) <= SIGNAL_TTL_MS);
};

const sendJson = (res, code, body) => {
  const payload = body == null ? '' : JSON.stringify(body);
  res.writeHead(code, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(payload);
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1024 * 1024) {
      reject(new Error('payload too large'));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!raw.trim()) {
      resolve({});
      return;
    }
    try {
      resolve(JSON.parse(raw));
    } catch {
      reject(new Error('invalid json'));
    }
  });
  req.on('error', reject);
});

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: 'bad request' });
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, null);
    return;
  }

  const { pathname = '', query = {} } = parseUrl(req.url, true);
  if (pathname === '/health') {
    sendJson(res, 200, { ok: true, now: nowIso() });
    return;
  }

  if (pathname === '/v1/auth/register' && req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }
    const account = String(body.account || '').trim();
    const password = String(body.password || '').trim();
    if (!account || !password) {
      sendJson(res, 400, { error: 'account and password are required' });
      return;
    }
    if (users.has(account)) {
      sendJson(res, 409, { error: 'account already exists' });
      return;
    }
    users.set(account, { account, password, created_at: nowIso() });
    const accessToken = `demo_${randomToken()}`;
    tokens.set(accessToken, { account, created_at: nowIso() });
    sendJson(res, 200, { access_token: accessToken });
    return;
  }

  if (pathname === '/v1/auth/login' && req.method === 'POST') {
    const body = await readJsonBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }
    const account = String(body.account || '').trim();
    const password = String(body.password || '').trim();
    if (!account || !password) {
      sendJson(res, 400, { error: 'account and password are required' });
      return;
    }
    const user = users.get(account);
    if (!user || user.password !== password) {
      sendJson(res, 401, { error: 'invalid account or password' });
      return;
    }
    const accessToken = `demo_${randomToken()}`;
    tokens.set(accessToken, { account, created_at: nowIso() });
    sendJson(res, 200, { access_token: accessToken });
    return;
  }

  const peerUpsert = pathname.match(/^\/v1\/rooms\/([^/]+)\/peers\/upsert$/);
  if (peerUpsert && req.method === 'POST') {
    const roomKey = decodeURIComponent(peerUpsert[1]);
    const body = await readJsonBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }
    const peerId = String(body.peer_id || '').trim();
    const userName = String(body.user_name || '').trim();
    if (!peerId || !userName) {
      sendJson(res, 400, { error: 'peer_id and user_name are required' });
      return;
    }
    const room = ensureRoom(roomKey);
    cleanupRoom(room);
    const existed = room.peers.get(peerId);
    const peer = {
      id: existed?.id ?? room.nextPeerId++,
      room_id: numericRoomId(roomKey),
      peer_id: peerId,
      user_name: userName,
      mic_on: Boolean(body.mic_on),
      camera_on: Boolean(body.camera_on),
      joined_at: existed?.joined_at ?? nowIso(),
      last_seen_at: nowIso(),
    };
    room.peers.set(peerId, peer);
    sendJson(res, 200, peer);
    return;
  }

  const peerList = pathname.match(/^\/v1\/rooms\/([^/]+)\/peers$/);
  if (peerList && req.method === 'GET') {
    const roomKey = decodeURIComponent(peerList[1]);
    const room = ensureRoom(roomKey);
    cleanupRoom(room);
    const peers = Array.from(room.peers.values()).sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at));
    sendJson(res, 200, peers);
    return;
  }

  const peerDelete = pathname.match(/^\/v1\/rooms\/([^/]+)\/peers\/([^/]+)$/);
  if (peerDelete && req.method === 'DELETE') {
    const roomKey = decodeURIComponent(peerDelete[1]);
    const peerId = decodeURIComponent(peerDelete[2]);
    const room = ensureRoom(roomKey);
    cleanupRoom(room);
    room.peers.delete(peerId);
    sendJson(res, 204, null);
    return;
  }

  const signalPublish = pathname.match(/^\/v1\/rooms\/([^/]+)\/signals$/);
  if (signalPublish && req.method === 'POST') {
    const roomKey = decodeURIComponent(signalPublish[1]);
    const body = await readJsonBody(req).catch(() => null);
    if (!body) {
      sendJson(res, 400, { error: 'invalid json' });
      return;
    }
    const fromPeerId = String(body.from_peer_id || '').trim();
    const toPeerId = String(body.to_peer_id || '').trim();
    const signalType = String(body.signal_type || '').trim();
    const payload = String(body.payload || '');
    if (!fromPeerId || !toPeerId || !signalType) {
      sendJson(res, 400, { error: 'from_peer_id, to_peer_id and signal_type are required' });
      return;
    }
    const room = ensureRoom(roomKey);
    cleanupRoom(room);
    const signal = {
      id: room.nextSignalId++,
      room_id: numericRoomId(roomKey),
      from_peer_id: fromPeerId,
      to_peer_id: toPeerId,
      signal_type: signalType,
      payload,
      created_at: nowIso(),
    };
    room.signals.push(signal);
    sendJson(res, 200, signal);
    return;
  }

  const signalPull = pathname.match(/^\/v1\/rooms\/([^/]+)\/signals$/);
  if (signalPull && req.method === 'GET') {
    const roomKey = decodeURIComponent(signalPull[1]);
    const toPeerId = String(query.to_peer_id || '').trim();
    const sinceId = Number(query.since_id || 0);
    if (!toPeerId) {
      sendJson(res, 400, { error: 'to_peer_id is required' });
      return;
    }
    const room = ensureRoom(roomKey);
    cleanupRoom(room);
    const signals = room.signals.filter((signal) => signal.to_peer_id === toPeerId && signal.id > sinceId);
    sendJson(res, 200, signals);
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[meeting-signal] listening on http://${HOST}:${PORT}`);
});
