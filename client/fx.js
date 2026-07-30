// Particles, impacts, explosions and flying projectile visuals.
import * as THREE from 'three';
import { makeDropletTexture, makeRingTexture } from './textures.js';
import { TEAMS } from '../shared/constants.js';
import { v3, vadd, vscale, vlen } from '../shared/world.js';

const MAX_PARTICLES = 1400;

export class Fx {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.time = 0;

    // --- droplet particles (single Points cloud) ---
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: makeDropletTexture() } },
      vertexShader: `
        attribute float size; varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 320.0 / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          if (t.a < 0.08) discard;
          gl_FragColor = vec4(vColor, t.a);
        }`,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.particles = [];

    // --- sprite decals (rings, flashes) ---
    this.ringTex = makeRingTexture();
    this.dropTex = mat.uniforms.uMap.value;
    this.sprites = [];

    // --- projectiles ---
    this.projectiles = [];
    this.projGeo = new THREE.SphereGeometry(1, 10, 8);
    this.projMats = TEAMS.map((t) => new THREE.MeshStandardMaterial({
      color: new THREE.Color(t.ink), emissive: new THREE.Color(t.ink),
      emissiveIntensity: 0.75, roughness: 0.2, metalness: 0,
    }));
    this.bombMat = new THREE.MeshStandardMaterial({ color: 0x2b2740, roughness: 0.4, metalness: 0.3 });
    this.projPool = [];
  }

  /* ------------------------------ particles ---------------------------- */

  spawnParticle(pos, vel, color, size, life, gravity = 22, sticky = true) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      p: v3(pos.x, pos.y, pos.z),
      v: v3(vel.x, vel.y, vel.z),
      c: color, s: size, life, maxLife: life, g: gravity, sticky,
    });
  }

  burst(pos, team, opts = {}) {
    const n = opts.count || 12;
    const color = opts.color || new THREE.Color(TEAMS[team]?.ink || '#ffffff');
    const speed = opts.speed || 4.5;
    const up = opts.up || 0.6;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.5;
      const s = speed * (0.35 + Math.random() * 0.8);
      this.spawnParticle(
        pos,
        v3(Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s * up * 3 + speed * up, Math.sin(a) * Math.cos(e) * s),
        color,
        (opts.size || 0.16) * (0.6 + Math.random() * 0.9),
        (opts.life || 0.75) * (0.6 + Math.random() * 0.7),
        opts.gravity ?? 22,
      );
    }
  }

  ring(pos, normal, color, opts = {}) {
    const spr = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.ringTex, color, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    spr.position.set(pos.x, pos.y, pos.z);
    if (normal) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal.x, normal.y, normal.z));
      spr.quaternion.copy(q);
    }
    spr.position.addScaledVector(new THREE.Vector3(normal?.x || 0, normal?.y || 1, normal?.z || 0), 0.06);
    this.scene.add(spr);
    this.sprites.push({
      obj: spr, life: opts.life || 0.5, maxLife: opts.life || 0.5,
      from: opts.from ?? 0.4, to: opts.to ?? 4.5, fade: true,
    });
    return spr;
  }

  flash(pos, color, intensity = 12, life = 0.18) {
    const light = new THREE.PointLight(color, intensity, 14, 2);
    light.position.set(pos.x, pos.y, pos.z);
    this.scene.add(light);
    this.sprites.push({ obj: light, life, maxLife: life, light: true });
  }

  impact(pos, team, normal, big = false) {
    const color = new THREE.Color(TEAMS[team]?.ink || '#fff');
    this.burst(pos, team, { count: big ? 22 : 9, speed: big ? 7 : 3.6, size: big ? 0.22 : 0.13, life: big ? 0.9 : 0.5 });
    this.ring(pos, normal || v3(0, 1, 0), color, { life: 0.32, from: 0.3, to: big ? 4 : 1.7 });
    if (big) this.flash(pos, color, 26, 0.24);
  }

  explosion(pos, team) {
    const color = new THREE.Color(TEAMS[team]?.ink || '#fff');
    this.burst(pos, team, { count: 46, speed: 12, size: 0.3, life: 1.1, up: 0.9 });
    this.ring(pos, v3(0, 1, 0), color, { life: 0.6, from: 0.5, to: 9 });
    this.ring(pos, v3(0, 1, 0), new THREE.Color(0xffffff), { life: 0.32, from: 0.3, to: 5 });
    this.flash(pos, color, 60, 0.4);
  }

  splatDeath(pos, team) {
    const color = new THREE.Color(TEAMS[team]?.ink || '#fff');
    this.burst(pos, team, { count: 60, speed: 9, size: 0.28, life: 1.3, up: 1.1 });
    this.ring(v3(pos.x, pos.y + 0.05, pos.z), v3(0, 1, 0), color, { life: 0.7, from: 0.4, to: 7 });
    this.flash(v3(pos.x, pos.y + 1, pos.z), color, 30, 0.3);
  }

  squidTrail(pos, team) {
    const color = new THREE.Color(TEAMS[team]?.ink || '#fff');
    this.spawnParticle(
      v3(pos.x + (Math.random() - 0.5) * 0.4, pos.y + 0.1, pos.z + (Math.random() - 0.5) * 0.4),
      v3((Math.random() - 0.5) * 1.2, 1.4 + Math.random(), (Math.random() - 0.5) * 1.2),
      color, 0.12 + Math.random() * 0.1, 0.4, 14,
    );
  }

  /* ----------------------------- projectiles --------------------------- */

  addProjectile(opts) {
    let mesh = this.projPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(this.projGeo, this.projMats[0]);
      mesh.castShadow = false;
    }
    mesh.material = opts.bomb ? this.bombMat : this.projMats[opts.team] || this.projMats[0];
    mesh.visible = true;
    const r = opts.radius || 0.18;
    mesh.scale.setScalar(r * (opts.bomb ? 1.6 : 2.4));
    mesh.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
    this.scene.add(mesh);
    const pr = {
      mesh,
      id: opts.id,
      team: opts.team,
      pos: v3(opts.pos.x, opts.pos.y, opts.pos.z),
      vel: v3(opts.vel.x, opts.vel.y, opts.vel.z),
      gravity: opts.gravity ?? 24,
      life: opts.life ?? 1,
      age: 0,
      radius: r,
      bomb: !!opts.bomb,
      local: !!opts.local,
      trailAccum: 0,
      onHit: opts.onHit,
    };
    this.projectiles.push(pr);
    return pr;
  }

  removeProjectileById(id) {
    const i = this.projectiles.findIndex((p) => p.id === id);
    if (i >= 0) this.retireProjectile(this.projectiles[i], i);
  }

  retireProjectile(pr, index) {
    this.scene.remove(pr.mesh);
    pr.mesh.visible = false;
    this.projPool.push(pr.mesh);
    const i = index ?? this.projectiles.indexOf(pr);
    if (i >= 0) this.projectiles.splice(i, 1);
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.age += dt;
      const steps = Math.max(1, Math.ceil(vlen(pr.vel) * dt / 0.6));
      const sdt = dt / steps;
      let dead = false;
      for (let s = 0; s < steps; s++) {
        pr.vel.y -= pr.gravity * sdt;
        const move = vscale(pr.vel, sdt);
        const dist = vlen(move);
        if (dist > 1e-5 && this.world) {
          const dir = vscale(move, 1 / dist);
          const hit = this.world.raycast(pr.pos, dir, dist);
          if (hit) {
            pr.pos = vadd(hit.point, vscale(hit.normal, 0.03));
            if (pr.bomb) { pr.vel = v3(0, 0, 0); pr.gravity = 0; pr.stuck = true; break; }
            if (pr.onHit) pr.onHit(pr.pos, hit.normal);
            dead = true;
            break;
          }
        }
        pr.pos = vadd(pr.pos, move);
      }
      if (!dead && !pr.bomb && pr.age > pr.life) dead = true;
      if (!dead && pr.pos.y < -30) dead = true;
      if (dead) { this.retireProjectile(pr, i); continue; }

      pr.mesh.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      // Stretch along the direction of travel for a nice ink-drop look.
      const sp = vlen(pr.vel);
      if (sp > 0.5 && !pr.bomb) {
        pr.mesh.lookAt(pr.pos.x + pr.vel.x, pr.pos.y + pr.vel.y, pr.pos.z + pr.vel.z);
        pr.mesh.scale.set(pr.radius * 2.2, pr.radius * 2.2, pr.radius * 2.2 * Math.min(2.6, 1 + sp * 0.03));
      } else if (pr.bomb) {
        pr.mesh.rotation.x += dt * 6;
        pr.mesh.rotation.z += dt * 4;
      }
      pr.trailAccum += dt;
      if (pr.trailAccum > 0.045 && !pr.stuck) {
        pr.trailAccum = 0;
        this.spawnParticle(pr.pos, v3(0, -0.4, 0), new THREE.Color(TEAMS[pr.team]?.ink || '#fff'),
          pr.radius * 1.1, 0.22, 4);
      }
    }
  }

  /* -------------------------------- tick ------------------------------- */

  update(dt) {
    this.time += dt;
    this.updateProjectiles(dt);

    // particles
    const arr = this.particles;
    let write = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.v.y -= p.g * dt;
      p.p.x += p.v.x * dt; p.p.y += p.v.y * dt; p.p.z += p.v.z * dt;
      arr[write++] = p;
    }
    arr.length = write;

    const n = Math.min(arr.length, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      const p = arr[i];
      const k = p.life / p.maxLife;
      this.pPos[i * 3] = p.p.x;
      this.pPos[i * 3 + 1] = p.p.y;
      this.pPos[i * 3 + 2] = p.p.z;
      this.pCol[i * 3] = p.c.r; this.pCol[i * 3 + 1] = p.c.g; this.pCol[i * 3 + 2] = p.c.b;
      this.pSize[i] = p.s * (0.4 + k * 0.9);
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;

    // sprites / lights
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.life -= dt;
      const k = 1 - s.life / s.maxLife;
      if (s.life <= 0) {
        this.scene.remove(s.obj);
        if (s.obj.geometry) s.obj.geometry.dispose();
        if (s.obj.material) s.obj.material.dispose();
        this.sprites.splice(i, 1);
        continue;
      }
      if (s.light) {
        s.obj.intensity = s.obj.intensity * (1 - dt * 6);
      } else {
        const sc = s.from + (s.to - s.from) * easeOut(k);
        s.obj.scale.set(sc, sc, sc);
        s.obj.material.opacity = 1 - k;
      }
    }
  }
}

function easeOut(t) { return 1 - Math.pow(1 - t, 2.5); }
