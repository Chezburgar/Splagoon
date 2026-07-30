// Inkopolis Plaza: the persistent hub every player lands in. Handles presence,
// chat, loadout changes and the matchmaking queue at the Deca Tower door.

import { Room } from './room.js';
import { TOWN } from '../shared/mapdata.js';
import { MATCH, MOVE, PLAYER, WEAPON_ORDER } from '../shared/constants.js';
import { S2C, PHASE, FLAG } from '../shared/protocol.js';
import { playerSnapshot } from './entity.js';
import { makeBot } from './bot.js';
import { v3, vdist, vlen, vnorm, vscale } from '../shared/world.js';

const move = { grounded: false, groundY: 0, hitWall: false };

export class Lobby extends Room {
  constructor(onMatchReady) {
    super('lobby', TOWN);
    this.kind = 'lobby';
    this.onMatchReady = onMatchReady;
    this.queue = new Set();
    this.queueTimer = 0;
    this.snapAccum = 0;
    this.tick = 0;
    this.townies = [];
    this.spawnTownies(4);
  }

  spawnTownies(n) {
    const names = ['Spyke', 'Crusty Sean', 'Jelfonzo', 'Harmony', 'Sheldon', 'Judd'];
    for (let i = 0; i < n; i++) {
      const b = makeBot(i % 2, names[i % names.length]);
      b.weapon = WEAPON_ORDER[i % WEAPON_ORDER.length];
      b.townie = true;
      const a = (i / n) * Math.PI * 2;
      b.pos = v3(Math.cos(a) * 12, 0.2, Math.sin(a) * 12);
      b.wander = v3(0, 0, 0);
      b.wanderAt = 0;
      this.add(b);
      this.townies.push(b);
    }
  }

  enter(p) {
    this.add(p);
    const group = this.world.map.spawns[0];
    const pt = group.points[Math.floor(Math.random() * group.points.length)];
    p.pos = v3(pt.x + (Math.random() - 0.5) * 4, pt.y, pt.z + (Math.random() - 0.5) * 3);
    p.vel = v3(0, 0, 0);
    p.yaw = pt.yaw;
    p.alive = true;
    p.hp = PLAYER.maxHealth;
    p.flags = 0;
    this.send(p, {
      t: S2C.ENTER,
      room: 'lobby',
      map: this.mapId,
      you: p.id,
      phase: PHASE.LOBBY,
      players: this.roster(),
      queue: { n: this.queue.size, seconds: this.queueTimer },
    });
    this.broadcast({ t: S2C.JOIN, player: { id: p.id, name: p.name, team: p.team, weapon: p.weapon, bot: p.bot } }, p.id);
  }

  onInput(p, msg) {
    if (Array.isArray(msg.p)) {
      const np = v3(msg.p[0], msg.p[1], msg.p[2]);
      if (Number.isFinite(np.x) && Number.isFinite(np.y) && Number.isFinite(np.z)) p.pos = np;
    }
    if (Array.isArray(msg.v)) p.vel = v3(msg.v[0], msg.v[1], msg.v[2]);
    if (typeof msg.y === 'number') p.yaw = msg.y;
    if (typeof msg.q === 'number') p.pitch = msg.q;
    if (typeof msg.f === 'number') p.flags = msg.f;
  }

  setQueued(p, on) {
    if (on) {
      if (this.queue.has(p.id)) return;
      this.queue.add(p.id);
      if (this.queue.size === 1) this.queueTimer = MATCH.lobbyQueueSeconds;
    } else {
      this.queue.delete(p.id);
      if (this.queue.size === 0) this.queueTimer = 0;
    }
    this.broadcastQueue();
  }

  broadcastQueue() {
    this.broadcast({
      t: S2C.QUEUE,
      n: this.queue.size,
      seconds: Math.max(0, Math.ceil(this.queueTimer)),
      ids: [...this.queue],
    });
  }

  update(dt) {
    this.time += dt;

    if (this.queue.size > 0) {
      this.queueTimer -= dt;
      // Everyone waiting jumps in together once the timer runs out (or the
      // lobby is full).
      if (this.queueTimer <= 0 || this.queue.size >= MATCH.maxPlayersPerTeam * 2) {
        const going = [...this.queue].map((id) => this.players.get(id)).filter((p) => p && p.conn);
        this.queue.clear();
        this.queueTimer = 0;
        if (going.length) {
          for (const p of going) this.players.delete(p.id);
          this.onMatchReady(going);
          this.broadcast({ t: S2C.LEAVE, ids: going.map((p) => p.id) });
        }
        this.broadcastQueue();
      } else if (Math.floor(this.queueTimer * 2) !== this.lastQueueBeat) {
        this.lastQueueBeat = Math.floor(this.queueTimer * 2);
        this.broadcastQueue();
      }
    }

    for (const b of this.townies) this.updateTownie(b, dt);

    this.snapAccum += dt;
    if (this.snapAccum >= 1 / 15) {
      this.snapAccum = 0;
      this.tick++;
      const ps = [];
      for (const p of this.players.values()) ps.push(playerSnapshot(p));
      this.broadcast({ t: S2C.STATE, k: this.tick, ps, ph: PHASE.LOBBY });
    }
  }

  updateTownie(b, dt) {
    if (this.time >= b.wanderAt) {
      b.wanderAt = this.time + 2.5 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 16;
      b.wander = v3(Math.cos(a) * r, 0, Math.sin(a) * r);
      b.idle = Math.random() < 0.3;
    }
    const to = v3(b.wander.x - b.pos.x, 0, b.wander.z - b.pos.z);
    const d = vlen(to);
    const dir = d > 0.5 ? vscale(to, 1 / d) : v3(0, 0, 0);
    const speed = b.idle ? 0 : MOVE.runSpeed * 0.45;
    b.vel.x += (dir.x * speed - b.vel.x) * Math.min(1, dt * 8);
    b.vel.z += (dir.z * speed - b.vel.z) * Math.min(1, dt * 8);
    b.vel.y -= MOVE.gravity * dt;
    this.world.moveCharacter(b.pos, b.vel, dt, PLAYER.radius, PLAYER.height, move);
    if (move.grounded) b.flags |= FLAG.GROUNDED; else b.flags &= ~FLAG.GROUNDED;
    if (Math.hypot(b.vel.x, b.vel.z) > 0.4) {
      b.flags |= FLAG.MOVING;
      b.yaw = Math.atan2(b.vel.x, b.vel.z);
    } else b.flags &= ~FLAG.MOVING;
    if (b.pos.y < -10) { b.pos = v3(0, 0.2, 10); b.vel = v3(0, 0, 0); }
  }
}
