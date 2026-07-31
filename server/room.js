import { World } from '../shared/world.js';
import { encode, S2C } from '../shared/protocol.js';
import { playerInfo } from './entity.js';

export class Room {
  constructor(id, mapDef) {
    this.id = id;
    this.mapId = mapDef.id;
    this.world = new World(mapDef);
    this.players = new Map();
    this.time = 0;
    this.closed = false;
  }

  add(player) {
    this.players.set(player.id, player);
    player.room = this;
  }

  remove(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    this.players.delete(playerId);
    if (p.room === this) p.room = null;
    this.broadcast({ t: S2C.LEAVE, id: playerId });
    return p;
  }

  send(player, msg) {
    if (!player || !player.conn) return;
    const ws = player.conn;
    if (ws.readyState !== 1) return;
    ws.send(typeof msg === 'string' ? msg : encode(msg));
  }

  broadcast(msg, exceptId = -1) {
    const raw = encode(msg);
    for (const p of this.players.values()) {
      if (p.id === exceptId || !p.conn) continue;
      if (p.conn.readyState === 1) p.conn.send(raw);
    }
  }

  roster() {
    return [...this.players.values()].map(playerInfo);
  }

  humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }
}
