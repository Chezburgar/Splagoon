// Splagoon game server: static file host + authoritative websocket game loop.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { Lobby } from './lobby.js';
import { Match } from './match.js';
import { makePlayer, playerInfo } from './entity.js';
import { C2S, S2C, decode, encode } from '../shared/protocol.js';
import { TICK_RATE, TICK_DT, WEAPONS, WEAPON_ORDER } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  if (p.startsWith('/vendor/three/')) {
    return path.join(ROOT, 'node_modules', 'three', p.slice('/vendor/three/'.length));
  }
  if (p.startsWith('/shared/')) return path.join(ROOT, p.slice(1));
  return path.join(ROOT, 'client', p.slice(1));
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url || '/');
  // Never serve outside the project.
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404 not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

/* ----------------------------- game world ------------------------------ */

const matches = new Map();
let matchSeq = 1;

const lobby = new Lobby((players) => {
  const id = `m${matchSeq++}`;
  const match = new Match(id, (m) => {
    // Match over: send everyone home to the plaza.
    for (const p of [...m.players.values()]) {
      if (!p.conn) continue;
      m.players.delete(p.id);
      lobby.enter(p);
    }
    matches.delete(m.id);
  });
  matches.set(id, match);
  match.begin(players);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const player = makePlayer({ conn: ws, name: 'Inkling' });
  player.room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    const msg = decode(raw.toString());
    if (!msg || typeof msg.t !== 'string') return;
    handleMessage(player, msg);
  });

  ws.on('close', () => {
    const room = player.room;
    if (room) {
      room.remove(player.id);
      if (room === lobby) lobby.queue.delete(player.id);
    }
  });

  ws.on('error', () => {});

  ws.send(encode({
    t: S2C.WELCOME,
    id: player.id,
    weapons: WEAPON_ORDER.map((k) => ({ ...WEAPONS[k] })),
  }));
});

function handleMessage(p, msg) {
  const room = p.room;
  switch (msg.t) {
    case C2S.HELLO: {
      p.name = String(msg.name || 'Inkling').slice(0, 14).replace(/[<>]/g, '') || 'Inkling';
      if (WEAPONS[msg.weapon]) { p.weapon = msg.weapon; p.specialKind = WEAPONS[msg.weapon].special; }
      if (msg.team === 0 || msg.team === 1) p.team = msg.team;
      if (typeof msg.gear === 'number') p.gear = msg.gear | 0;
      if (!room) lobby.enter(p);
      break;
    }
    case C2S.INPUT:
      if (room) room.onInput(p, msg);
      break;
    case C2S.FIRE:
      if (room && room.onFire) room.onFire(p, msg);
      break;
    case C2S.SUB:
      if (room && room.onSub) room.onSub(p, msg);
      break;
    case C2S.SPECIAL:
      if (room && room.onSpecial) room.onSpecial(p, msg);
      break;
    case C2S.WEAPON:
      if (WEAPONS[msg.weapon] && room === lobby) {
        p.weapon = msg.weapon;
        p.specialKind = WEAPONS[msg.weapon].special;
        lobby.broadcast({ t: S2C.JOIN, player: playerInfo(p) });
      }
      break;
    case C2S.QUEUE:
      if (room === lobby) lobby.setQueued(p, true);
      break;
    case C2S.UNQUEUE:
      if (room === lobby) lobby.setQueued(p, false);
      break;
    case C2S.CHAT: {
      const text = String(msg.msg || '').slice(0, 80).replace(/[<>]/g, '');
      if (text && room) room.broadcast({ t: S2C.CHAT, id: p.id, name: p.name, msg: text });
      break;
    }
    case C2S.LEAVE_MATCH: {
      if (room && room !== lobby) {
        room.players.delete(p.id);
        room.broadcast({ t: S2C.LEAVE, id: p.id });
        lobby.enter(p);
      }
      break;
    }
    case C2S.PING:
      if (p.conn && p.conn.readyState === 1) p.conn.send(encode({ t: S2C.PONG, s: msg.s }));
      break;
    default:
      break;
  }
}

/* ------------------------------- main loop ----------------------------- */

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  try {
    lobby.update(dt);
    for (const m of [...matches.values()]) {
      m.update(dt);
      if (m.closed) matches.delete(m.id);
    }
  } catch (err) {
    console.error('[tick]', err);
  }
}, 1000 / TICK_RATE);

// Drop dead sockets.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`\n  Splagoon running -> http://localhost:${PORT}\n`);
});
