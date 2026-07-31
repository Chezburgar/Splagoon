// Bot inklings. They use the exact same movement code as players, so they
// climb ramps, fall off ledges and swim in ink just like a human would.

import { makePlayer } from './entity.js';
import { MOVE, PLAYER, INK, WEAPONS, WEAPON_ORDER, clamp } from '../shared/constants.js';
import { FLAG } from '../shared/protocol.js';
import { v3, vsub, vlen, vdist, vnorm, vscale } from '../shared/world.js';

const SKILL = { react: 0.16, aimError: 0.055, viewRange: 21 };

export function makeBot(team, name, weaponId) {
  const weapon = weaponId && WEAPONS[weaponId]
    ? weaponId
    : WEAPON_ORDER[Math.floor(Math.random() * WEAPON_ORDER.length)];
  const p = makePlayer({ name, team, weapon, bot: true });
  p.specialKind = WEAPONS[weapon].special;
  p.ai = {
    goal: null,
    thinkAt: 0,
    stuckTimer: 0,
    lastPos: v3(0, 0, 0),
    targetId: -1,
    aimError: v3(0, 0, 0),
    squidUntil: 0,
    strafe: Math.random() < 0.5 ? 1 : -1,
    skill: 0.7 + Math.random() * 0.5,
  };
  return p;
}

const move = { grounded: false, groundY: 0, hitWall: false };

export function updateBot(match, p, dt) {
  const ai = p.ai;
  const world = match.world;
  const w = WEAPONS[p.weapon];
  const now = match.time;

  if (now >= ai.thinkAt) {
    ai.thinkAt = now + 0.22 + Math.random() * 0.16;
    think(match, p);
  }

  // ---- ink economy: hide in own ink to refill -------------------------
  const inkTeam = world.inkAtGround(p.pos.x, p.pos.y + 0.1, p.pos.z);
  const wantSquid = (p.ink < 28 && inkTeam === p.team) || now < ai.squidUntil;
  if (p.ink < 28 && inkTeam === p.team && now >= ai.squidUntil) ai.squidUntil = now + 1.1;
  const squid = wantSquid && p.ink < INK.capacity * 0.92;
  if (squid) {
    p.flags |= FLAG.SQUID;
    p.ink = Math.min(INK.capacity, p.ink + INK.refillRate * dt);
  } else {
    p.flags &= ~FLAG.SQUID;
    ai.squidUntil = 0;
  }

  // ---- combat ---------------------------------------------------------
  const enemy = ai.targetId >= 0 ? match.players.get(ai.targetId) : null;
  let aimDir = null;
  let engaged = false;
  if (enemy && enemy.alive && !squid) {
    const eye = v3(p.pos.x, p.pos.y + PLAYER.eyeHeight, p.pos.z);
    const tgt = v3(enemy.pos.x, enemy.pos.y + 0.9, enemy.pos.z);
    const flat = vdist(v3(p.pos.x, 0, p.pos.z), v3(enemy.pos.x, 0, enemy.pos.z));
    // Lead the shot for the projectile drop.
    const drop = w.projectileGravity * Math.pow(flat / Math.max(6, w.projectileSpeed), 2) * 0.5;
    tgt.y += drop;
    tgt.x += enemy.vel.x * 0.12 + ai.aimError.x;
    tgt.z += enemy.vel.z * 0.12 + ai.aimError.z;
    aimDir = vnorm(vsub(tgt, eye));
    if (!world.losBlocked(eye, tgt, 0.4)) {
      engaged = true;
      if (w.kind === 'charger') {
        p.charge = Math.min(1, (p.charge || 0) + dt / w.chargeTime);
        if (p.charge >= 0.85) { match.onFire(p, { d: [aimDir.x, aimDir.y, aimDir.z], c: p.charge }); p.charge = 0; }
      } else {
        match.onFire(p, { d: [aimDir.x, aimDir.y, aimDir.z] });
      }
      if (p.specialCharge >= 100 && Math.random() < 0.02) {
        match.onSpecial(p, { d: [aimDir.x, aimDir.y, aimDir.z] });
      } else if (p.ink > 75 && Math.random() < 0.006 && flat > 5 && flat < 18) {
        const lob = vnorm(v3(aimDir.x, aimDir.y + 0.35, aimDir.z));
        match.onSub(p, { d: [lob.x, lob.y, lob.z] });
      }
    }
  }
  if (!engaged && !squid && p.ink > 20) {
    // Not shooting at anyone: keep painting turf ahead, which is how a turf
    // war is actually won.
    const yaw = p.yaw;
    const fwd = v3(Math.sin(yaw), 0, Math.cos(yaw));
    const aim = vnorm(v3(fwd.x, -0.22 - Math.random() * 0.1, fwd.z));
    if (w.kind === 'charger') {
      p.charge = Math.min(1, (p.charge || 0) + dt / w.chargeTime);
      if (p.charge >= 0.6) { match.onFire(p, { d: [aim.x, aim.y, aim.z], c: p.charge }); p.charge = 0; }
    } else {
      match.onFire(p, { d: [aim.x, aim.y, aim.z] });
    }
    if (p.specialCharge >= 100 && Math.random() < 0.01) match.onSpecial(p, { d: [aim.x, aim.y, aim.z] });
  }

  // ---- steering -------------------------------------------------------
  const goal = ai.goal || v3(0, 0, 0);
  let dir = v3(goal.x - p.pos.x, 0, goal.z - p.pos.z);
  const distToGoal = vlen(dir) || 1;
  dir = vscale(dir, 1 / distToGoal);
  if (distToGoal < 2.5) ai.thinkAt = 0;

  // Obstacle probe: if something is right in front, slide along it.
  const probe = v3(p.pos.x, p.pos.y + 0.6, p.pos.z);
  const hit = world.raycast(probe, dir, 2.2);
  if (hit) {
    const side = v3(-dir.z * ai.strafe, 0, dir.x * ai.strafe);
    dir = vnorm(v3(dir.x * 0.35 + side.x, 0, dir.z * 0.35 + side.z));
    if (Math.random() < 0.02) ai.strafe *= -1;
  }

  // Combat strafing keeps duels lively.
  if (enemy && enemy.alive && aimDir) {
    const d = vdist(p.pos, enemy.pos);
    const side = v3(-aimDir.z, 0, aimDir.x);
    const push = d < 6 ? -0.6 : d > 14 ? 0.6 : 0;
    dir = vnorm(v3(
      aimDir.x * push + side.x * ai.strafe * 0.8 + dir.x * 0.2,
      0,
      aimDir.z * push + side.z * ai.strafe * 0.8 + dir.z * 0.2,
    ));
  }

  const speed = squid
    ? (inkTeam === p.team ? MOVE.swimSpeed * 0.9 : MOVE.squidDrySpeed)
    : (inkTeam === (1 - p.team) ? MOVE.enemyInkSpeed : MOVE.runSpeed * (0.85 + ai.skill * 0.12));

  const wish = squid && p.ink < INK.capacity * 0.9 && inkTeam === p.team ? 0.25 : 1;
  p.vel.x += (dir.x * speed * wish - p.vel.x) * Math.min(1, MOVE.accelGround * dt / Math.max(1, speed));
  p.vel.z += (dir.z * speed * wish - p.vel.z) * Math.min(1, MOVE.accelGround * dt / Math.max(1, speed));
  p.vel.y -= MOVE.gravity * dt;

  const grounded = (p.flags & FLAG.GROUNDED) !== 0;
  if (grounded && (hit || ai.stuckTimer > 0.9) && Math.random() < 0.25) {
    p.vel.y = MOVE.jumpSpeed;
    ai.stuckTimer = 0;
  }

  const radius = squid ? PLAYER.squidRadius : PLAYER.radius;
  const height = squid ? PLAYER.squidHeight : PLAYER.height;
  world.moveCharacter(p.pos, p.vel, dt, radius, height, move);
  if (move.grounded) p.flags |= FLAG.GROUNDED; else p.flags &= ~FLAG.GROUNDED;
  if (Math.hypot(p.vel.x, p.vel.z) > 0.6) p.flags |= FLAG.MOVING; else p.flags &= ~FLAG.MOVING;

  // Facing.
  const faceDir = enemy && enemy.alive && aimDir ? aimDir : dir;
  const wantYaw = Math.atan2(faceDir.x, faceDir.z);
  p.yaw = angleLerp(p.yaw, wantYaw, Math.min(1, dt * 9));
  p.pitch = enemy && aimDir ? clamp(Math.asin(clamp(-aimDir.y, -1, 1)), -1.2, 1.2) : 0;

  // Out of bounds / pit rescue.
  if (p.pos.y < world.map.killY + 4) {
    match.splatPlayer(p, { id: -1, team: 1 - p.team }, 'pit');
    return;
  }

  // Stuck detection.
  if (vdist(p.pos, ai.lastPos) < 0.25) ai.stuckTimer += dt;
  else { ai.stuckTimer = 0; ai.lastPos = v3(p.pos.x, p.pos.y, p.pos.z); }
  if (ai.stuckTimer > 2.2) { ai.stuckTimer = 0; ai.goal = null; ai.thinkAt = 0; ai.strafe *= -1; }
}

function think(match, p) {
  const ai = p.ai;
  const world = match.world;

  // Pick the closest visible enemy.
  let best = null, bestScore = Infinity;
  const eye = v3(p.pos.x, p.pos.y + PLAYER.eyeHeight, p.pos.z);
  for (const o of match.players.values()) {
    if (!o.alive || o.team === p.team) continue;
    const d = vdist(p.pos, o.pos);
    if (d > SKILL.viewRange) continue;
    const hidden = (o.flags & FLAG.SQUID) && world.inkAtGround(o.pos.x, o.pos.y + 0.1, o.pos.z) === o.team;
    if (hidden && d > 6) continue;
    if (world.losBlocked(eye, v3(o.pos.x, o.pos.y + 0.9, o.pos.z), 0.5)) continue;
    if (d < bestScore) { bestScore = d; best = o; }
  }
  ai.targetId = best ? best.id : -1;
  const err = SKILL.aimError * (2 - ai.skill) * Math.max(1, bestScore * 0.12);
  ai.aimError = v3((Math.random() - 0.5) * err * 6, 0, (Math.random() - 0.5) * err * 6);

  if (best) {
    ai.goal = v3(best.pos.x, best.pos.y, best.pos.z);
    ai.goalUntil = 0;
    return;
  }

  // Keep walking to the same patch of turf until it is reached, has been
  // claimed, or the bot has spent too long trying: re-rolling every think
  // made them mill around in circles repainting ground they already owned.
  if (ai.goal && match.time < (ai.goalUntil || 0)) {
    const d = vdist(p.pos, ai.goal);
    const owned = world.inkAtGround(ai.goal.x, ai.goal.y + 0.1, ai.goal.z) === p.team;
    if (d > 2.5 && !owned) return;
  }
  ai.goalUntil = match.time + 9;

  // Otherwise head for unpainted turf, biased toward the middle of the stage.
  const b = world.map.bounds;
  let bestGoal = null, bestVal = -Infinity;
  for (let i = 0; i < 14; i++) {
    const x = b.minX + Math.random() * (b.maxX - b.minX);
    const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
    const g = world.groundHeightAt(x, z, 40);
    if (g === -Infinity) continue;
    const team = world.inkAtGround(x, g + 0.1, z);
    const d = vdist(p.pos, v3(x, g, z));
    let val = 0;
    if (team === -1) val += 34;
    else if (team !== p.team) val += 46;
    val -= d * 0.2;
    val -= Math.abs(z) * 0.12;                // slight pull toward the middle
    val += Math.random() * 8;
    if (val > bestVal) { bestVal = val; bestGoal = v3(x, g, z); }
  }
  if (bestGoal) ai.goal = bestGoal;
}

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}
