// Offline mode: the whole authoritative server, running inside the page.
//
// server/ is plain JavaScript with no Node dependencies outside index.js, so
// the lobby, the match room and the bots can be instantiated in the browser
// and spoken to over an in-memory socket. That is what makes the static
// GitHub Pages build playable: same simulation, same protocol, no network.

import { Lobby } from '../server/lobby.js';
import { Match } from '../server/match.js';
import { makePlayer } from '../server/entity.js';
import { encode, decode, S2C } from '../shared/protocol.js';
import { TICK_RATE, WEAPONS, WEAPON_ORDER } from '../shared/constants.js';

export class OfflineServer {
  constructor(opts = {}) {
    this.matches = new Map();
    this.matchSeq = 1;
    this.lobby = new Lobby((players) => this.startMatch(players), {
      queueSeconds: opts.queueSeconds ?? 5,
    });
    this.inbox = [];        // messages waiting to be handed to the client
    this.player = null;
    this.onmessage = null;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  startMatch(players) {
    const id = `m${this.matchSeq++}`;
    const match = new Match(id, (m) => {
      for (const p of [...m.players.values()]) {
        if (!p.conn) continue;
        m.players.delete(p.id);
        this.lobby.enter(p);
      }
      this.matches.delete(m.id);
    });
    this.matches.set(id, match);
    match.begin(players);
  }

  // A stand-in for a WebSocket, from the server's point of view.
  makeConnection() {
    const inbox = this.inbox;
    return {
      readyState: 1,
      send(raw) { inbox.push(raw); },
      close() { this.readyState = 3; },
    };
  }

  // Called by Net instead of opening a socket.
  attach(onmessage) {
    this.onmessage = onmessage;
    const conn = this.makeConnection();
    this.player = makePlayer({ conn, name: 'Inkling' });
    this.player.room = null;
    conn.send(encode({
      t: S2C.WELCOME,
      id: this.player.id,
      offline: true,
      weapons: WEAPON_ORDER.map((k) => ({ ...WEAPONS[k] })),
    }));
    this.flush();
  }

  // Client -> server.
  receive(raw) {
    const msg = decode(raw);
    if (!msg || typeof msg.t !== 'string') return;
    try {
      this.handle(msg);
    } catch (err) {
      console.error('[offline]', err);
    }
    this.flush();
  }

  handle(msg) {
    const p = this.player;
    const room = p.room;
    switch (msg.t) {
      case 'hello':
        p.name = String(msg.name || 'Inkling').slice(0, 14).replace(/[<>]/g, '') || 'Inkling';
        if (WEAPONS[msg.weapon]) { p.weapon = msg.weapon; p.specialKind = WEAPONS[msg.weapon].special; }
        if (msg.team === 0 || msg.team === 1) p.team = msg.team;
        if (!room) this.lobby.enter(p);
        break;
      case 'input': if (room) room.onInput(p, msg); break;
      case 'fire': if (room && room.onFire) room.onFire(p, msg); break;
      case 'sub': if (room && room.onSub) room.onSub(p, msg); break;
      case 'special': if (room && room.onSpecial) room.onSpecial(p, msg); break;
      case 'weapon':
        if (WEAPONS[msg.weapon] && room === this.lobby) {
          p.weapon = msg.weapon;
          p.specialKind = WEAPONS[msg.weapon].special;
        }
        break;
      case 'queue': if (room === this.lobby) this.lobby.setQueued(p, true); break;
      case 'unqueue': if (room === this.lobby) this.lobby.setQueued(p, false); break;
      case 'chat': {
        const text = String(msg.msg || '').slice(0, 80).replace(/[<>]/g, '');
        if (text && room) room.broadcast({ t: S2C.CHAT, id: p.id, name: p.name, msg: text });
        break;
      }
      case 'leaveMatch':
        if (room && room !== this.lobby) {
          room.players.delete(p.id);
          this.lobby.enter(p);
        }
        break;
      case 'ping':
        this.player.conn.send(encode({ t: S2C.PONG, s: msg.s }));
        break;
      default: break;
    }
  }

  tick() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    try {
      this.lobby.update(dt);
      for (const m of [...this.matches.values()]) {
        m.update(dt);
        if (m.closed) this.matches.delete(m.id);
      }
    } catch (err) {
      console.error('[offline tick]', err);
    }
    this.flush();
  }

  // Server -> client. Drained on a separate turn so the server never
  // re-enters the client mid-handler.
  flush() {
    if (!this.onmessage || !this.inbox.length) return;
    const batch = this.inbox.splice(0, this.inbox.length);
    for (const raw of batch) this.onmessage(raw);
  }

  close() {
    clearInterval(this.timer);
    this.onmessage = null;
  }
}
