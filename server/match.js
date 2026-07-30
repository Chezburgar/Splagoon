import { Room } from './room.js';
import { ARENA } from '../shared/mapdata.js';
import {
  MATCH, WEAPONS, SUB, SPECIALS, PLAYER, INK, MOVE, TICK_DT, clamp,
} from '../shared/constants.js';
import { S2C, PHASE, FLAG } from '../shared/protocol.js';
import { playerSnapshot, playerInfo } from './entity.js';
import { v3, vadd, vsub, vscale, vnorm, vlen, vdist, rayCapsule } from '../shared/world.js';
import { updateBot, makeBot } from './bot.js';

let projId = 1;

export class Match extends Room {
  constructor(id, onFinished) {
    super(id, ARENA);
    this.kind = 'battle';
    this.onFinished = onFinished;
    this.phase = PHASE.COUNTDOWN;
    this.phaseTime = MATCH.countdown;
    this.projectiles = [];
    this.pending = [];        // delayed events (inkstrike impacts, bomb fuses)
    this.storms = [];
    this.snapAccum = 0;
    this.tick = 0;
    this.results = null;
  }

  begin(players) {
    // Balance teams, then fill with bots so a match always feels full.
    const list = [...players];
    list.forEach((p, i) => { p.team = i % 2; });
    for (const p of list) this.join(p, false);
    this.fillWithBots();
    this.broadcastEnter();
  }

  fillWithBots() {
    const counts = [0, 0];
    for (const p of this.players.values()) counts[p.team]++;
    const target = Math.max(2, Math.min(MATCH.maxPlayersPerTeam, Math.max(counts[0], counts[1], 2)));
    for (let team = 0; team < 2; team++) {
      while (counts[team] < target) {
        const bot = makeBot(team, this.botName(team, counts[team]));
        this.join(bot, true);
        counts[team]++;
      }
    }
  }

  botName(team, idx) {
    const names = ['Squiddo', 'Marina', 'Callie', 'Jelonzo', 'Bisk', 'Sheldon', 'Murch', 'Judd',
      'Annie', 'Crusty', 'Flow', 'Craymond'];
    return names[(team * 6 + idx + Math.floor(Math.random() * 3)) % names.length];
  }

  join(p, isBot) {
    this.add(p);
    p.kills = 0; p.deaths = 0; p.turf = 0;
    p.specialCharge = 0; p.specialActive = 0;
    p.specialKind = WEAPONS[p.weapon].special;
    p.hp = PLAYER.maxHealth;
    p.ink = INK.capacity;
    p.alive = true;
    p.flags = 0;
    p.bot = isBot || p.bot;
    this.placeAtSpawn(p);
  }

  placeAtSpawn(p) {
    const group = this.world.map.spawns.find((s) => s.team === p.team) || this.world.map.spawns[0];
    const idx = [...this.players.values()].filter((o) => o.team === p.team).indexOf(p);
    const pt = group.points[Math.max(0, idx) % group.points.length];
    p.pos = v3(pt.x, pt.y, pt.z);
    p.vel = v3(0, 0, 0);
    p.yaw = pt.yaw;
    p.pitch = 0;
    p.hp = PLAYER.maxHealth;
    p.ink = INK.capacity;
    p.alive = true;
    p.flags = 0;
    p.invulnUntil = this.time + PLAYER.invulnAfterSpawn;
  }

  broadcastEnter() {
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      this.send(p, {
        t: S2C.ENTER,
        room: 'match',
        map: this.mapId,
        you: p.id,
        team: p.team,
        phase: this.phase,
        timeLeft: this.phaseTime,
        players: this.roster(),
      });
    }
  }

  /* ------------------------------ input -------------------------------- */

  onInput(p, msg) {
    if (!p.alive) return;
    if (Array.isArray(msg.p)) {
      const np = v3(msg.p[0], msg.p[1], msg.p[2]);
      if (!Number.isFinite(np.x) || !Number.isFinite(np.y) || !Number.isFinite(np.z)) return;
      const d = vdist(np, p.pos);
      if (d > 6) {
        // Way beyond what any legal move allows: snap the client back.
        this.send(p, { t: S2C.RESPAWN, id: p.id, p: [p.pos.x, p.pos.y, p.pos.z], correction: true });
      } else {
        p.pos = np;
      }
    }
    if (Array.isArray(msg.v)) p.vel = v3(msg.v[0], msg.v[1], msg.v[2]);
    if (typeof msg.y === 'number') p.yaw = msg.y;
    if (typeof msg.q === 'number') p.pitch = msg.q;
    if (typeof msg.f === 'number') p.flags = (msg.f & (FLAG.SQUID | FLAG.FIRING | FLAG.GROUNDED | FLAG.CLIMBING | FLAG.MOVING));
  }

  onFire(p, msg) {
    if (!p.alive || this.phase === PHASE.ENDED) return;
    const w = WEAPONS[p.weapon];
    if (this.time - p.lastFire < w.fireInterval) return;
    if (p.ink < w.inkCost) return;
    const dir = readDir(msg.d);
    if (!dir) return;
    p.lastFire = this.time;
    p.ink = Math.max(0, p.ink - w.inkCost);

    const origin = this.muzzle(p, dir);
    const charge = clamp(msg.c || 0, 0, 1);

    if (w.kind === 'roller') {
      this.rollerFlick(p, dir, origin);
      return;
    }
    if (w.kind === 'charger') {
      const dmg = w.damage + (w.fullChargeDamage - w.damage) * charge;
      const speed = w.projectileSpeed * (0.55 + 0.45 * charge);
      this.spawnProjectile(p, origin, vscale(dir, speed), {
        gravity: w.projectileGravity, life: w.projectileLife * (0.6 + 0.6 * charge),
        radius: w.projectileRadius * (0.7 + 0.8 * charge), damage: dmg,
        splatRadius: w.splatRadius * (0.7 + 0.9 * charge), trail: charge > 0.35, pierce: charge > 0.9,
      });
      return;
    }
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const d = jitter(dir, w.spread * (pellets > 1 ? 1 + i * 0.35 : 1));
      const speed = w.projectileSpeed * (pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
      this.spawnProjectile(p, origin, vscale(d, speed), {
        gravity: w.projectileGravity, life: w.projectileLife,
        radius: w.projectileRadius, damage: w.damage,
        splatRadius: w.splatRadius * (0.85 + Math.random() * 0.3),
      });
    }
  }

  rollerFlick(p, dir, origin) {
    const w = WEAPONS.roller;
    const flat = vnorm(v3(dir.x, dir.y * 0.35 + 0.12, dir.z));
    for (let i = 0; i < 7; i++) {
      const spread = (i - 3) / 3 * 0.28;
      const d = vnorm(v3(
        flat.x * Math.cos(spread) - flat.z * Math.sin(spread),
        flat.y + (Math.random() - 0.5) * 0.06,
        flat.x * Math.sin(spread) + flat.z * Math.cos(spread),
      ));
      this.spawnProjectile(p, origin, vscale(d, w.projectileSpeed * (0.8 + Math.random() * 0.4)), {
        gravity: w.projectileGravity, life: w.projectileLife,
        radius: w.projectileRadius, damage: w.damage,
        splatRadius: w.splatRadius, kind: 'blob',
      });
    }
    this.broadcast({ t: S2C.FX, k: 'flick', p: [origin.x, origin.y, origin.z], team: p.team, id: p.id });
  }

  onSub(p, msg) {
    if (!p.alive || p.ink < SUB.inkCost) return;
    if (this.time - (p.lastSub || -99) < 0.7) return;
    p.lastSub = this.time;
    p.ink -= SUB.inkCost;
    const dir = readDir(msg.d) || v3(0, 1, 0);
    const origin = this.muzzle(p, dir);
    this.spawnProjectile(p, origin, vscale(dir, SUB.throwSpeed), {
      gravity: SUB.gravity, life: 6, radius: 0.24, damage: 0,
      splatRadius: 0, sub: true, fuse: this.time + SUB.fuse, kind: 'bomb',
    });
  }

  onSpecial(p, msg) {
    if (!p.alive || p.specialCharge < 100) return;
    const kind = p.specialKind;
    const def = SPECIALS[kind];
    if (!def) return;
    p.specialCharge = 0;
    p.flags |= FLAG.SPECIAL;
    const dir = readDir(msg.d) || v3(0, 0, 1);

    if (kind === 'inkstrike' || kind === 'inkstorm') {
      const eye = v3(p.pos.x, p.pos.y + PLAYER.eyeHeight, p.pos.z);
      const hit = this.world.raycast(eye, dir, 70);
      const target = hit ? hit.point : vadd(eye, vscale(dir, 45));
      target.y = Math.max(target.y, this.world.groundHeightAt(target.x, target.z, target.y + 2));
      this.broadcast({ t: S2C.SPECIAL, k: kind, id: p.id, team: p.team, target: [target.x, target.y, target.z] });
      if (kind === 'inkstrike') {
        this.pending.push({ at: this.time + SPECIALS.inkstrike.delay, fn: () => this.inkstrikeImpact(p, target) });
      } else {
        this.storms.push({ owner: p.id, team: p.team, pos: target, until: this.time + def.duration, next: this.time });
      }
    } else if (kind === 'splashdown') {
      p.invulnUntil = this.time + SPECIALS.splashdown.duration;
      this.broadcast({ t: S2C.SPECIAL, k: kind, id: p.id, team: p.team });
      this.pending.push({
        at: this.time + SPECIALS.splashdown.duration * 0.75,
        fn: () => {
          const c = v3(p.pos.x, p.pos.y + 0.2, p.pos.z);
          this.radialBlast(p, c, SPECIALS.splashdown.radius, SPECIALS.splashdown.damage);
        },
      });
    } else if (kind === 'bubbler') {
      p.invulnUntil = this.time + SPECIALS.bubbler.duration;
      this.broadcast({ t: S2C.SPECIAL, k: kind, id: p.id, team: p.team });
      this.pending.push({ at: this.time + SPECIALS.bubbler.duration, fn: () => { p.flags &= ~FLAG.SPECIAL; } });
    }
  }

  inkstrikeImpact(p, target) {
    const def = SPECIALS.inkstrike;
    this.broadcast({ t: S2C.FX, k: 'inkstrikeHit', p: [target.x, target.y, target.z], team: p.team });
    this.radialBlast(p, target, def.radius, def.damage);
    // A ring of extra splats gives the strike its spiral footprint.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = def.radius * (0.45 + 0.5 * ((i % 3) / 2));
      const q = v3(target.x + Math.cos(a) * r, target.y + 1.0, target.z + Math.sin(a) * r);
      this.applySplat(q, 2.4, p, 'strike');
    }
  }

  radialBlast(p, center, radius, damage) {
    this.applySplat(v3(center.x, center.y + 0.4, center.z), radius, p, 'blast');
    for (const o of this.players.values()) {
      if (!o.alive || o.team === p.team) continue;
      const c = v3(o.pos.x, o.pos.y + 0.8, o.pos.z);
      const d = vdist(c, center);
      if (d > radius + 0.5) continue;
      if (this.world.losBlocked(center, c, 0.3)) continue;
      const falloff = clamp(1 - (d / (radius + 0.5)) * 0.6, 0.3, 1);
      this.damage(o, damage * falloff, p, 'special');
    }
  }

  muzzle(p, dir) {
    const h = (p.flags & FLAG.SQUID) ? 0.4 : 1.15;
    return v3(p.pos.x + dir.x * 0.45, p.pos.y + h, p.pos.z + dir.z * 0.45);
  }

  /* --------------------------- projectiles ------------------------------ */

  spawnProjectile(owner, pos, vel, opts) {
    const pr = {
      id: projId++,
      owner: owner.id,
      team: owner.team,
      weapon: owner.weapon,
      kind: opts.kind || 'ink',
      pos: v3(pos.x, pos.y, pos.z),
      vel: v3(vel.x, vel.y, vel.z),
      gravity: opts.gravity ?? 24,
      life: opts.life ?? 1,
      radius: opts.radius ?? 0.16,
      damage: opts.damage ?? 0,
      splatRadius: opts.splatRadius ?? 1,
      trail: !!opts.trail,
      pierce: !!opts.pierce,
      sub: !!opts.sub,
      fuse: opts.fuse ?? 0,
      born: this.time,
      trailAccum: 0,
    };
    this.projectiles.push(pr);
    this.broadcast({
      t: S2C.PROJ,
      i: pr.id, o: pr.owner, tm: pr.team, k: pr.kind, w: pr.weapon,
      p: [r2(pos.x), r2(pos.y), r2(pos.z)],
      v: [r2(vel.x), r2(vel.y), r2(vel.z)],
      g: pr.gravity, l: pr.life, r: r2(pr.radius), sr: r2(pr.splatRadius),
    }, owner.bot ? -1 : owner.id);
    return pr;
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const pr of this.projectiles) {
      const owner = this.players.get(pr.owner);
      let alive = true;
      const steps = Math.max(1, Math.ceil(vlen(pr.vel) * dt / 0.55));
      const sdt = dt / steps;
      for (let s = 0; s < steps && alive; s++) {
        pr.vel.y -= pr.gravity * sdt;
        const from = v3(pr.pos.x, pr.pos.y, pr.pos.z);
        const move = vscale(pr.vel, sdt);
        const dist = vlen(move);
        if (dist > 1e-5) {
          const dir = vscale(move, 1 / dist);
          // players first
          if (pr.damage > 0) {
            let bestT = Infinity, victim = null;
            for (const o of this.players.values()) {
              if (!o.alive || o.team === pr.team || o.id === pr.owner) continue;
              const squid = (o.flags & FLAG.SQUID) !== 0;
              const h = squid ? PLAYER.squidHeight : PLAYER.height;
              const rad = (squid ? PLAYER.squidRadius : PLAYER.radius) + pr.radius;
              const t = rayCapsule(from, dir, o.pos, h, rad);
              if (t !== null && t <= dist && t < bestT) { bestT = t; victim = o; }
            }
            if (victim) {
              const hp = vadd(from, vscale(dir, bestT));
              if (owner) this.damage(victim, pr.damage, owner, pr.weapon);
              this.applySplat(hp, pr.splatRadius * 0.7, owner || { team: pr.team, id: pr.owner }, 'hit');
              this.broadcast({ t: S2C.FX, k: 'impact', p: [r2(hp.x), r2(hp.y), r2(hp.z)], team: pr.team, o: pr.owner });
              if (!pr.pierce) { alive = false; break; }
            }
          }
          const hit = this.world.raycast(from, dir, dist);
          if (hit) {
            const point = vadd(hit.point, vscale(hit.normal, 0.02));
            if (pr.sub) {
              // Bombs settle where they land and detonate on their fuse.
              pr.pos = vadd(hit.point, vscale(hit.normal, 0.18));
              pr.vel = v3(0, 0, 0);
              pr.gravity = 0;
              pr.stuck = true;
              break;
            }
            this.applySplat(point, pr.splatRadius, owner || { team: pr.team, id: pr.owner }, 'ink');
            this.broadcast({ t: S2C.FX, k: 'impact', p: [r2(point.x), r2(point.y), r2(point.z)], team: pr.team, o: pr.owner, n: [r2(hit.normal.x), r2(hit.normal.y), r2(hit.normal.z)] });
            alive = false;
            break;
          }
        }
        pr.pos = vadd(pr.pos, move);
        if (pr.trail) {
          pr.trailAccum += dist;
          if (pr.trailAccum > 1.4) {
            pr.trailAccum = 0;
            const down = this.world.raycast(pr.pos, v3(0, -1, 0), 4);
            if (down) this.applySplat(vadd(down.point, v3(0, 0.02, 0)), pr.splatRadius * 0.55, owner || { team: pr.team, id: pr.owner }, 'ink');
          }
        }
      }

      if (alive && pr.sub && this.time >= pr.fuse) {
        this.explodeBomb(pr, owner);
        alive = false;
      }
      if (alive && this.time - pr.born > pr.life && !pr.sub) alive = false;
      if (alive && pr.pos.y < this.world.map.killY) alive = false;
      if (alive) keep.push(pr);
    }
    this.projectiles = keep;
  }

  explodeBomb(pr, owner) {
    const src = owner || { team: pr.team, id: pr.owner };
    this.broadcast({ t: S2C.FX, k: 'bomb', p: [r2(pr.pos.x), r2(pr.pos.y), r2(pr.pos.z)], team: pr.team });
    this.applySplat(pr.pos, SUB.splatRadius, src, 'blast');
    for (const o of this.players.values()) {
      if (!o.alive || o.team === pr.team) continue;
      const c = v3(o.pos.x, o.pos.y + 0.7, o.pos.z);
      const d = vdist(c, pr.pos);
      if (d > SUB.blastRadius) continue;
      if (this.world.losBlocked(pr.pos, c, 0.3)) continue;
      const dmg = d < 1.1 ? SUB.directDamage : SUB.splashDamage * (1 - d / SUB.blastRadius) * 1.6;
      this.damage(o, dmg, src, 'bomb');
    }
  }

  /* ------------------------------- ink ---------------------------------- */

  applySplat(pos, radius, owner, fx = 'ink') {
    if (this.phase === PHASE.ENDED) return;
    const team = owner.team;
    const hits = this.world.splat(pos, radius, team);
    let changed = 0;
    for (const h of hits) changed += h.changed;
    if (owner && owner.id != null) {
      const p = this.players.get(owner.id);
      if (p) {
        p.turf += changed;
        const w = WEAPONS[p.weapon];
        if (p.specialCharge < 100) {
          p.specialCharge = Math.min(100, p.specialCharge + (changed / w.specialPoints) * 100 * 0.35);
        }
      }
    }
    this.broadcast({
      t: S2C.SPLAT,
      p: [r2(pos.x), r2(pos.y), r2(pos.z)],
      r: r2(radius), tm: team, s: (this.world.splatSeq++) & 1023, k: fx,
    });
  }

  /* ----------------------------- combat --------------------------------- */

  damage(target, amount, by, weapon) {
    if (!target.alive || this.time < target.invulnUntil) return;
    target.hp -= amount;
    this.broadcast({ t: S2C.HIT, id: target.id, by: by.id, h: Math.max(0, Math.round(target.hp)), d: Math.round(amount) });
    if (target.hp <= 0) this.splatPlayer(target, by, weapon);
  }

  splatPlayer(target, by, weapon) {
    target.alive = false;
    target.hp = 0;
    target.deaths++;
    target.flags |= FLAG.DEAD;
    target.respawnAt = this.time + PLAYER.respawnTime;
    const killer = by && by.id !== target.id ? this.players.get(by.id) : null;
    if (killer) {
      killer.kills++;
      killer.specialCharge = Math.min(100, killer.specialCharge + 8);
    }
    // Death burst paints the ground in the killer's colour.
    this.applySplat(v3(target.pos.x, target.pos.y + 0.4, target.pos.z), 2.6,
      killer || { team: 1 - target.team, id: -1 }, 'death');
    this.broadcast({
      t: S2C.SPLATTED,
      id: target.id, by: killer ? killer.id : -1, w: weapon || 'ink',
      p: [r2(target.pos.x), r2(target.pos.y), r2(target.pos.z)],
      team: target.team,
    });
  }

  respawn(p) {
    this.placeAtSpawn(p);
    p.flags &= ~FLAG.DEAD;
    this.broadcast({ t: S2C.RESPAWN, id: p.id, p: [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)], y: r2(p.yaw) });
  }

  /* ------------------------------ update -------------------------------- */

  update(dt) {
    this.time += dt;

    if (this.phase === PHASE.COUNTDOWN) {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) {
        this.phase = PHASE.ACTIVE;
        this.phaseTime = MATCH.duration;
        this.broadcast({ t: S2C.MATCH, phase: this.phase, timeLeft: this.phaseTime });
      }
    } else if (this.phase === PHASE.ACTIVE) {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) this.finish();
    } else if (this.phase === PHASE.ENDED) {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0 && this.onFinished) { this.onFinished(this); this.closed = true; return; }
    }

    // Delayed events.
    if (this.pending.length) {
      const due = this.pending.filter((e) => e.at <= this.time);
      if (due.length) {
        this.pending = this.pending.filter((e) => e.at > this.time);
        for (const e of due) e.fn();
      }
    }

    // Ink storms rain over their target area.
    if (this.storms.length) {
      for (const st of this.storms) {
        if (this.time >= st.next) {
          st.next = this.time + 0.14;
          const owner = this.players.get(st.owner) || { id: st.owner, team: st.team };
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * SPECIALS.inkstorm.radius;
          const q = v3(st.pos.x + Math.cos(a) * r, st.pos.y + 0.3, st.pos.z + Math.sin(a) * r);
          const g = this.world.groundHeightAt(q.x, q.z, q.y + 6);
          if (g > -Infinity) {
            this.applySplat(v3(q.x, g + 0.05, q.z), 1.5, owner, 'rain');
            for (const o of this.players.values()) {
              if (!o.alive || o.team === st.team) continue;
              if (vdist(o.pos, q) < 1.6) this.damage(o, SPECIALS.inkstorm.damage, owner, 'inkstorm');
            }
          }
        }
      }
      this.storms = this.storms.filter((s) => s.until > this.time);
    }

    this.updateProjectiles(dt);

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.time >= p.respawnAt && this.phase !== PHASE.ENDED) this.respawn(p);
        continue;
      }
      if (p.bot) updateBot(this, p, dt);
      else this.updateHumanServerSide(p, dt);
    }

    // Snapshots.
    this.snapAccum += dt;
    if (this.snapAccum >= 1 / 20) {
      this.snapAccum = 0;
      this.sendSnapshot();
    }
  }

  updateHumanServerSide(p, dt) {
    // The client owns its own movement; the server owns ink economy, the
    // roller's ground paint and enemy-ink damage.
    if (p.pos.y < this.world.map.killY + 2) {
      this.splatPlayer(p, { id: -1, team: 1 - p.team }, 'pit');
      return;
    }
    const w = WEAPONS[p.weapon];
    const squid = (p.flags & FLAG.SQUID) !== 0;
    const inkTeam = this.world.inkAtGround(p.pos.x, p.pos.y + 0.1, p.pos.z);

    if (squid && inkTeam === p.team) {
      p.ink = Math.min(INK.capacity, p.ink + INK.refillRate * dt);
    }
    if (!squid && inkTeam === (1 - p.team) && (p.flags & FLAG.GROUNDED)) {
      p.enemyInkTimer = (p.enemyInkTimer || 0) + dt;
      if (p.enemyInkTimer > 0.35) {
        p.enemyInkTimer = 0;
        this.damage(p, MOVE.enemyInkDps * 0.35, { id: -1, team: 1 - p.team }, 'enemyInk');
      }
    } else p.enemyInkTimer = 0;

    if (w.kind === 'roller' && (p.flags & FLAG.FIRING) && (p.flags & FLAG.GROUNDED) && !squid) {
      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (speed > 1.2 && p.ink > 0) {
        p.ink = Math.max(0, p.ink - w.rollInkCost * dt);
        const fwd = v3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const q = v3(p.pos.x + fwd.x * 0.9, p.pos.y + 0.12, p.pos.z + fwd.z * 0.9);
        p.rollAccum = (p.rollAccum || 0) + dt;
        if (p.rollAccum > 0.07) {
          p.rollAccum = 0;
          this.applySplat(q, w.rollSplatRadius, p, 'roll');
        }
        for (const o of this.players.values()) {
          if (!o.alive || o.team === p.team) continue;
          if (vdist(o.pos, q) < 1.25) this.damage(o, w.rollDamage, p, 'roller');
        }
      }
    }
  }

  sendSnapshot() {
    this.tick++;
    const ps = [];
    for (const p of this.players.values()) ps.push(playerSnapshot(p));
    const cov = this.world.coverage();
    this.broadcast({
      t: S2C.STATE,
      k: this.tick,
      tm: Math.max(0, Math.round(this.phaseTime * 10) / 10),
      ph: this.phase,
      sc: [Math.round(cov[0] * 1000) / 10, Math.round(cov[1] * 1000) / 10],
      ps,
    });
  }

  finish() {
    this.phase = PHASE.ENDED;
    this.phaseTime = MATCH.resultsTime;
    const cov = this.world.coverage();
    const a = Math.round(cov[0] * 1000) / 10;
    const b = Math.round(cov[1] * 1000) / 10;
    const winner = a === b ? -1 : (a > b ? 0 : 1);
    this.results = {
      score: [a, b],
      winner,
      players: [...this.players.values()].map(playerInfo).sort((x, y) => y.turf - x.turf),
    };
    this.broadcast({ t: S2C.RESULTS, ...this.results, timeLeft: this.phaseTime });
  }
}

function r2(n) { return Math.round(n * 100) / 100; }

function readDir(d) {
  if (!Array.isArray(d) || d.length < 3) return null;
  const v = v3(d[0], d[1], d[2]);
  const l = vlen(v);
  if (!Number.isFinite(l) || l < 1e-4) return null;
  return vscale(v, 1 / l);
}

function jitter(dir, spread) {
  if (spread <= 0) return dir;
  const up = Math.abs(dir.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const right = vnorm(v3(
    dir.y * up.z - dir.z * up.y,
    dir.z * up.x - dir.x * up.z,
    dir.x * up.y - dir.y * up.x,
  ));
  const realUp = vnorm(v3(
    right.y * dir.z - right.z * dir.y,
    right.z * dir.x - right.x * dir.z,
    right.x * dir.y - right.y * dir.x,
  ));
  const a = (Math.random() - 0.5) * 2 * spread;
  const b = (Math.random() - 0.5) * 2 * spread;
  return vnorm(vadd(dir, vadd(vscale(right, a), vscale(realUp, b))));
}
