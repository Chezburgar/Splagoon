// Networked inklings: snapshot smoothing plus animation state.
import * as THREE from 'three';
import { Inkling } from './models.js';
import { FLAG } from '../shared/protocol.js';
import { TEAMS } from '../shared/constants.js';
import { v3 } from '../shared/world.js';

export class RemotePlayer {
  constructor(scene, info, world) {
    this.id = info.id;
    this.name = info.name;
    this.team = info.team ?? 0;
    this.weapon = info.weapon || 'shooter';
    this.world = world;
    this.model = new Inkling({ team: this.team, name: this.name, weapon: this.weapon });
    this.object = this.model.root;
    scene.add(this.object);
    this.scene = scene;

    this.pos = new THREE.Vector3(0, -50, 0);
    this.target = new THREE.Vector3(0, -50, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.pitch = 0;
    this.flags = 0;
    this.alive = true;
    this.hp = 100;
    this.trailAccum = 0;
    this.firstSnap = true;
  }

  setInfo(info) {
    if (info.weapon && info.weapon !== this.weapon) {
      this.weapon = info.weapon;
      this.model.setWeapon(info.weapon);
    }
  }

  snapshot(s) {
    this.target.set(s.p[0], s.p[1], s.p[2]);
    this.vel.set(s.v[0], s.v[1], s.v[2]);
    this.targetYaw = s.y;
    this.pitch = s.q;
    this.flags = s.f;
    this.hp = s.h;
    this.alive = (s.f & FLAG.DEAD) === 0;
    if (this.firstSnap) {
      this.firstSnap = false;
      this.pos.copy(this.target);
      this.yaw = this.targetYaw;
    }
  }

  update(dt, fx) {
    // Extrapolate along the last known velocity, then ease onto the target.
    this.target.addScaledVector(this.vel, dt * 0.85);
    const k = 1 - Math.pow(0.0001, dt);
    this.pos.lerp(this.target, k);

    let dy = ((this.targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.yaw += dy * Math.min(1, dt * 14);

    const squid = (this.flags & FLAG.SQUID) !== 0;
    this.model.setSquid(squid);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const submerged = squid && !!this.world?.paintable &&
      this.world.inkAtGround(this.pos.x, this.pos.y + 0.1, this.pos.z) === this.team &&
      (this.flags & FLAG.GROUNDED) !== 0;

    // A squid swimming in friendly ink is hidden — only its wake gives it away.
    this.model.setVisible(this.alive && !(squid && submerged));

    this.object.position.copy(this.pos);
    this.object.rotation.y = this.yaw;
    this.model.update(dt, {
      speed,
      grounded: (this.flags & FLAG.GROUNDED) !== 0,
      pitch: this.pitch,
      submerged,
    });

    if (squid && submerged && speed > 1 && fx) {
      this.trailAccum += dt;
      if (this.trailAccum > 0.04) {
        this.trailAccum = 0;
        fx.squidTrail(v3(this.pos.x, this.pos.y, this.pos.z), this.team);
      }
    }
    if ((this.flags & FLAG.SPECIAL) && this.alive) {
      if (!this.bubble) {
        const geo = new THREE.SphereGeometry(1.35, 20, 14);
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(TEAMS[this.team].glow), transparent: true,
          opacity: 0.28, side: THREE.DoubleSide,
        });
        this.bubble = new THREE.Mesh(geo, mat);
        this.object.add(this.bubble);
        this.bubble.position.y = 0.9;
      }
      this.bubble.scale.setScalar(1 + Math.sin(performance.now() * 0.006) * 0.05);
    } else if (this.bubble) {
      this.object.remove(this.bubble);
      this.bubble.geometry.dispose();
      this.bubble.material.dispose();
      this.bubble = null;
    }
  }

  dispose() {
    this.scene.remove(this.object);
    this.model.dispose();
  }
}
