// Local player: input, movement (shared with the server's collision code),
// third-person camera, weapon handling and ink prediction.

import * as THREE from 'three';
import { MOVE, PLAYER, INK, WEAPONS, SUB, clamp } from '../shared/constants.js';
import { FLAG, C2S } from '../shared/protocol.js';
import { v3, vlen, vnorm, vsub } from '../shared/world.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.enabled = true;
    this.onKey = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, true, e);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.onKey) this.onKey(e.code, false, e);
    });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = false; this.mouse.right = false; });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.mouse.left = false; this.mouse.right = false; }
    });
  }

  lock() {
    // Chrome returns a promise that rejects without a user gesture.
    try { const r = this.canvas.requestPointerLock?.(); if (r && r.catch) r.catch(() => {}); } catch { /* ignore */ }
  }
  unlock() { try { document.exitPointerLock?.(); } catch { /* ignore */ } }
  down(code) { return this.enabled && this.keys.has(code); }
  consumeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return m;
  }
}

const moveOut = { grounded: false, groundY: 0, hitWall: false };

export class LocalPlayer {
  constructor(game) {
    this.game = game;
    this.pos = v3(0, 2, 0);
    this.vel = v3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = false;
    this.squid = false;
    this.climbing = false;
    this.submerged = false;
    this.alive = true;
    this.hp = PLAYER.maxHealth;
    this.ink = INK.capacity;
    this.specialCharge = 0;
    this.weapon = 'shooter';
    this.team = 0;

    this.camYaw = 0;
    this.camPitch = 0.12;
    this.camDist = 5.3;
    this.camPos = new THREE.Vector3(0, 3, 6);
    this.aimPoint = new THREE.Vector3();

    this.lastFire = -99;
    this.lastSub = -99;
    this.charge = 0;
    this.wasGrounded = true;
    this.swimSfxAccum = 0;
    this.time = 0;
    this.canControl = true;
  }

  get world() { return this.game.world; }

  spawn(pos, yaw) {
    this.pos = v3(pos.x, pos.y, pos.z);
    this.vel = v3(0, 0, 0);
    this.yaw = yaw ?? 0;
    this.camYaw = this.yaw;
    this.camPitch = 0.1;
    this.alive = true;
    this.hp = PLAYER.maxHealth;
    this.ink = INK.capacity;
    this.squid = false;
    this.climbing = false;
  }

  flags() {
    let f = 0;
    if (this.squid) f |= FLAG.SQUID;
    if (this.firing) f |= FLAG.FIRING;
    if (this.grounded) f |= FLAG.GROUNDED;
    if (!this.alive) f |= FLAG.DEAD;
    if (this.climbing) f |= FLAG.CLIMBING;
    if (Math.hypot(this.vel.x, this.vel.z) > 0.6) f |= FLAG.MOVING;
    return f;
  }

  update(dt, input, camera) {
    this.time += dt;
    const game = this.game;
    const world = this.world;
    const w = WEAPONS[this.weapon];

    // ---------------------------- look ---------------------------------
    if (input.locked && this.canControl) {
      const m = input.consumeMouse();
      this.camYaw -= m.dx * input.sensitivity;
      this.camPitch = clamp(this.camPitch + m.dy * input.sensitivity, -0.95, 1.15);
    } else {
      input.consumeMouse();
    }

    const canAct = this.alive && this.canControl;

    // ---------------------------- movement ------------------------------
    const inkTeam = world.paintable ? world.inkAtGround(this.pos.x, this.pos.y + 0.1, this.pos.z) : -1;
    const onOwnInk = inkTeam === this.team;
    const onEnemyInk = inkTeam >= 0 && inkTeam !== this.team;

    const wantSquid = canAct && input.down('ShiftLeft') || (canAct && input.down('ShiftRight'));
    if (wantSquid !== this.squid) {
      this.squid = wantSquid;
      if (wantSquid) game.audio.squidIn(); else game.audio.squidOut();
      if (wantSquid) game.fx.ring(v3(this.pos.x, this.pos.y + 0.05, this.pos.z), v3(0, 1, 0),
        new THREE.Color(game.teamColorHex(this.team)), { life: 0.4, from: 0.4, to: 3 });
    }
    this.submerged = this.squid && onOwnInk && this.grounded;

    let wishX = 0, wishZ = 0;
    if (canAct) {
      const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
      const r = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
      const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
      wishX = sin * f + cos * r;
      wishZ = cos * f - sin * r;
      const l = Math.hypot(wishX, wishZ);
      if (l > 1) { wishX /= l; wishZ /= l; }
    }

    let speed = MOVE.runSpeed;
    if (this.squid) speed = this.submerged ? MOVE.swimSpeed : (onOwnInk ? MOVE.swimSpeed * 0.85 : MOVE.squidDrySpeed);
    else if (onEnemyInk && this.grounded) speed = MOVE.enemyInkSpeed;

    const accel = this.grounded ? MOVE.accelGround : MOVE.accelAir * (this.squid ? 1.4 : 1);
    const control = this.grounded ? 1 : MOVE.airControl;
    this.vel.x += (wishX * speed - this.vel.x) * Math.min(1, accel * control * dt / Math.max(2.5, speed));
    this.vel.z += (wishZ * speed - this.vel.z) * Math.min(1, accel * control * dt / Math.max(2.5, speed));
    if (this.grounded && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - MOVE.friction * dt);
      this.vel.x *= damp; this.vel.z *= damp;
    }

    // wall climbing in squid form
    this.climbing = false;
    if (this.squid && world.paintable && this.ink > 1) {
      const wall = world.climbableWall(this.pos, this.team, PLAYER.squidRadius + 0.18);
      if (wall) {
        const into = -(wishX * wall.normal.x + wishZ * wall.normal.z);
        if (into > 0.2 || (this.vel.y > 0 && into > -0.2)) {
          this.climbing = true;
          this.vel.y = MOVE.climbSpeed;
          this.ink = Math.max(0, this.ink - 7 * dt);
          // hug the wall
          this.vel.x -= wall.normal.x * 2 * dt * 8;
          this.vel.z -= wall.normal.z * 2 * dt * 8;
          if (Math.random() < dt * 12) {
            game.fx.squidTrail(v3(this.pos.x, this.pos.y + 0.5, this.pos.z), this.team);
          }
        }
      }
    }

    if (!this.climbing) this.vel.y -= MOVE.gravity * dt;

    if (canAct && input.down('Space') && this.grounded) {
      this.vel.y = this.squid ? MOVE.squidJumpSpeed : MOVE.jumpSpeed;
      this.grounded = false;
      game.audio.jump();
      if (this.submerged) {
        game.fx.burst(v3(this.pos.x, this.pos.y + 0.1, this.pos.z), this.team, { count: 10, speed: 3, size: 0.14, life: 0.5 });
      }
    }

    const radius = this.squid ? PLAYER.squidRadius : PLAYER.radius;
    const height = this.squid ? PLAYER.squidHeight : PLAYER.height;
    world.moveCharacter(this.pos, this.vel, dt, radius, height, moveOut);
    if (moveOut.grounded && !this.wasGrounded && !this.squid) game.audio.land();
    this.wasGrounded = moveOut.grounded;
    this.grounded = moveOut.grounded;

    // swim particles + refill
    if (this.submerged) {
      this.ink = Math.min(INK.capacity, this.ink + INK.refillRate * dt);
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 2) {
        this.swimSfxAccum += dt;
        if (Math.random() < dt * 26) game.fx.squidTrail(this.pos, this.team);
        if (this.swimSfxAccum > 0.42) { this.swimSfxAccum = 0; game.audio.swim(); }
      }
    }

    // Fell out of the world.
    if (this.pos.y < world.map.killY) {
      this.pos = v3(this.pos.x, 40, this.pos.z);
      this.vel = v3(0, 0, 0);
      if (game.room === 'match') game.onSelfPit();
      else this.spawn({ x: 0, y: 2, z: 12 }, 0);
    }

    // ---------------------------- camera --------------------------------
    this.updateCamera(dt, camera);

    // ---------------------------- weapons -------------------------------
    this.firing = false;
    if (canAct && input.locked) this.handleWeapons(dt, input, w);
    else this.charge = 0;

    this.yaw = this.camYaw;
    this.pitch = this.camPitch;
  }

  updateCamera(dt, camera) {
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + (this.squid ? 0.75 : 1.35), this.pos.z);
    const dir = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      -Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    );
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const want = eye.clone()
      .addScaledVector(dir, -this.camDist)
      .addScaledVector(right, 0.66)
      .add(new THREE.Vector3(0, 0.55, 0));

    // Pull the camera in if the stage is in the way.
    const toCam = want.clone().sub(eye);
    const dist = toCam.length();
    const nd = toCam.clone().normalize();
    const hit = this.world.raycast(v3(eye.x, eye.y, eye.z), v3(nd.x, nd.y, nd.z), dist + 0.4);
    let finalDist = dist;
    if (hit) finalDist = Math.max(0.9, hit.t - 0.35);
    const target = eye.clone().addScaledVector(nd, finalDist);

    this.camPos.lerp(target, 1 - Math.pow(0.0009, dt));
    camera.position.copy(this.camPos);
    camera.lookAt(eye.clone().addScaledVector(dir, 6));

    // Aim point under the crosshair.
    const aimDir = new THREE.Vector3();
    camera.getWorldDirection(aimDir);
    const h = this.world.raycast(
      v3(camera.position.x, camera.position.y, camera.position.z),
      v3(aimDir.x, aimDir.y, aimDir.z), 120,
    );
    if (h) this.aimPoint.set(h.point.x, h.point.y, h.point.z);
    else this.aimPoint.copy(camera.position).addScaledVector(aimDir, 60);
  }

  muzzlePos() {
    const dir = this.aimDir();
    return v3(
      this.pos.x + dir.x * 0.45,
      this.pos.y + (this.squid ? 0.4 : 1.15),
      this.pos.z + dir.z * 0.45,
    );
  }

  aimDir() {
    const from = v3(this.pos.x, this.pos.y + (this.squid ? 0.4 : 1.15), this.pos.z);
    const d = vsub(v3(this.aimPoint.x, this.aimPoint.y, this.aimPoint.z), from);
    const l = vlen(d);
    if (l < 0.2) return v3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    return v3(d.x / l, d.y / l, d.z / l);
  }

  handleWeapons(dt, input, w) {
    const game = this.game;
    const now = this.time;
    const trigger = input.mouse.left;

    if (w.kind === 'charger') {
      if (trigger && this.ink >= w.inkCost) {
        if (!this.squid) {
          this.charge = Math.min(1, this.charge + dt / w.chargeTime);
          if (Math.random() < dt * 8) game.audio.charge(this.charge);
        }
      } else if (this.charge > 0.12) {
        this.fire(this.charge);
        this.charge = 0;
      } else this.charge = 0;
      game.setChargeUI?.(this.charge);
    } else if (trigger) {
      if (w.kind === 'roller') {
        // Rolling paints; the server handles the ground strip.
        const speed = Math.hypot(this.vel.x, this.vel.z);
        if (this.grounded && speed > 1.2 && !this.squid) {
          this.firing = true;
          this.ink = Math.max(0, this.ink - w.rollInkCost * dt);
          if (Math.random() < dt * 14) game.audio.swim();
        } else if (now - this.lastFire > w.fireInterval) {
          this.fire(0);
        }
      } else if (now - this.lastFire > w.fireInterval) {
        this.fire(0);
      }
    }

    if (input.down('KeyQ') && now - this.lastSub > 0.75 && this.ink >= SUB.inkCost && !this.squid) {
      this.lastSub = now;
      this.ink -= SUB.inkCost;
      const dir = this.aimDir();
      const lob = vnorm(v3(dir.x, dir.y + 0.42, dir.z));
      game.net.send({ t: C2S.SUB, d: [lob.x, lob.y, lob.z] });
      game.fx.addProjectile({
        id: -1, team: this.team, pos: this.muzzlePos(),
        vel: { x: lob.x * SUB.throwSpeed, y: lob.y * SUB.throwSpeed, z: lob.z * SUB.throwSpeed },
        gravity: SUB.gravity, life: SUB.fuse, radius: 0.24, bomb: true, local: true,
      });
      game.audio.ui();
    }

    if (input.down('KeyE') && this.specialCharge >= 100) {
      const dir = this.aimDir();
      game.net.send({ t: C2S.SPECIAL, d: [dir.x, dir.y, dir.z] });
      this.specialCharge = 0;
      game.audio.special();
    }
  }

  fire(charge) {
    const game = this.game;
    const w = WEAPONS[this.weapon];
    if (this.ink < w.inkCost) {
      if (Math.random() < 0.1) game.hud.announce('OUT OF INK!', 700, '#ff5b5b');
      return;
    }
    if (this.squid) this.squid = false;
    this.lastFire = this.time;
    this.ink = Math.max(0, this.ink - w.inkCost);
    this.firing = true;

    const dir = this.aimDir();
    game.net.send({ t: C2S.FIRE, d: [dir.x, dir.y, dir.z], c: charge });
    game.audio.shoot(w.kind);
    game.onLocalFire(dir, charge);
  }

  netState() {
    return {
      t: C2S.INPUT,
      p: [round(this.pos.x), round(this.pos.y), round(this.pos.z)],
      v: [round(this.vel.x), round(this.vel.y), round(this.vel.z)],
      y: round(this.yaw), q: round(this.pitch),
      f: this.flags(),
    };
  }
}

function round(n) { return Math.round(n * 100) / 100; }
