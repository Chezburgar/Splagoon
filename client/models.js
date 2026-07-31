// Procedural inkling + squid + weapon models, animated with plain sine math.
import * as THREE from 'three';
import { TEAMS } from '../shared/constants.js';
import { makeNameTexture } from './textures.js';

const SKIN = 0xf7d9b8;
const SHOE = 0x2b2740;

function mat(color, rough = 0.7, metal = 0.05, emissive = 0x000000, ei = 0) {
  return new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal,
    emissive: new THREE.Color(emissive), emissiveIntensity: ei,
  });
}

export function makeWeapon(id, inkColor) {
  const g = new THREE.Group();
  const body = mat(0x2f2b48, 0.5, 0.4);
  const accent = mat(inkColor, 0.35, 0.1, inkColor, 0.35);
  const grey = mat(0xb9c0cc, 0.4, 0.6);

  if (id === 'roller') {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.15, 8), body);
    handle.rotation.z = Math.PI / 2.6;
    handle.position.set(0.1, 0.0, 0.4);
    g.add(handle);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.62, 16), accent);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0.05, -0.34, 0.95);
    g.add(drum);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16), grey);
    cap.rotation.z = Math.PI / 2; cap.position.copy(drum.position);
    g.add(cap);
  } else if (id === 'charger') {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.7, 10), grey);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.75);
    g.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.6), body);
    stock.position.set(0, -0.04, -0.18);
    g.add(stock);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), body);
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.17, 0.35);
    g.add(scope);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), accent);
    tank.position.set(0, 0.02, -0.06);
    g.add(tank);
  } else if (id === 'slosher') {
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.5, 14, 1, true), body);
    bucket.rotation.x = Math.PI / 2.2;
    bucket.position.set(0, 0, 0.42);
    bucket.material.side = THREE.DoubleSide;
    g.add(bucket);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 8, 18), accent);
    rim.rotation.x = Math.PI / 2.2 + Math.PI / 2;
    rim.position.set(0, 0.11, 0.55);
    g.add(rim);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), grey);
    handle.rotation.x = Math.PI / 2.2;
    handle.position.set(0, -0.1, 0.1);
    g.add(handle);
  } else { // shooter
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.72, 10), grey);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, 0.42);
    g.add(barrel);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.42), body);
    box.position.set(0, 0, 0.04);
    g.add(box);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.28, 0.14), body);
    grip.position.set(0, -0.2, -0.05);
    grip.rotation.x = -0.25;
    g.add(grip);
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), accent);
    tank.position.set(0, 0.16, -0.1);
    g.add(tank);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

export class Inkling {
  constructor({ team = 0, name = 'Inkling', weapon = 'shooter', isLocal = false } = {}) {
    this.team = team;
    this.name = name;
    this.weaponId = weapon;
    this.isLocal = isLocal;
    this.inkColor = new THREE.Color(TEAMS[team].ink);
    this.glowColor = new THREE.Color(TEAMS[team].glow);

    this.root = new THREE.Group();
    this.humanoid = new THREE.Group();
    this.squid = new THREE.Group();
    this.root.add(this.humanoid, this.squid);
    this.squid.visible = false;

    this.phase = Math.random() * 6.28;
    this.t = 0;
    this.squidMode = false;
    this.fireKick = 0;

    this.buildHumanoid();
    this.buildSquid();
    this.buildNameplate();
  }

  buildHumanoid() {
    const ink = mat(this.inkColor.getHex(), 0.45, 0.05, this.inkColor.getHex(), 0.12);
    const cloth = mat(0xf2f2f7, 0.8, 0.0);
    const skin = mat(SKIN, 0.85, 0.0);
    const shoe = mat(SHOE, 0.6, 0.1);

    const g = this.humanoid;

    // legs
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), mat(0x3b3757, 0.8));
      thigh.position.y = -0.22;
      leg.add(thigh);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.32), shoe);
      foot.position.set(0, -0.46, 0.05);
      leg.add(foot);
      leg.position.set(side * 0.14, 0.52, 0);
      leg.userData.side = side;
      g.add(leg);
      this.legs.push(leg);
    }

    // torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.3, 5, 12), cloth);
    torso.position.y = 0.88;
    g.add(torso);
    this.torso = torso;

    const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.245, 0.16, 5, 12), ink);
    vest.position.y = 0.98;
    vest.scale.z = 0.85;
    g.add(vest);

    // arms
    this.arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 8), skin);
      upper.position.y = -0.2;
      arm.add(upper);
      arm.position.set(side * 0.27, 1.03, 0);
      g.add(arm);
      this.arms.push(arm);
    }

    // head
    const head = new THREE.Group();
    head.position.y = 1.34;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 16), skin);
    skull.scale.set(1, 0.98, 1.02);
    head.add(skull);

    // eyes
    for (const side of [-1, 1]) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), mat(0xffffff, 0.35));
      white.position.set(side * 0.115, 0.03, 0.23);
      white.scale.set(1, 1.25, 0.6);
      head.add(white);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat(0x141024, 0.2));
      pupil.position.set(side * 0.12, 0.03, 0.29);
      pupil.scale.set(1, 1.2, 0.5);
      head.add(pupil);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(side * 0.14, 0.07, 0.32);
      head.add(shine);
    }

    // tentacle hair
    this.tentacles = [];
    const tentMat = mat(this.inkColor.getHex(), 0.4, 0.05, this.inkColor.getHex(), 0.22);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.285, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), tentMat);
    cap.position.y = 0.02;
    head.add(cap);
    for (let i = 0; i < 3; i++) {
      const t = new THREE.Group();
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.34, 4, 8), tentMat);
      seg.position.y = -0.24;
      t.add(seg);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 6), tentMat);
      tip.position.y = -0.45;
      t.add(tip);
      const a = (i - 1) * 0.34;
      t.position.set((i - 1) * 0.13, 0.04, -0.24 - Math.abs(i - 1) * 0.03);
      t.rotation.x = 0.6;
      t.rotation.z = -a * 0.9;
      head.add(t);
      this.tentacles.push(t);
    }
    this.head = head;
    g.add(head);

    // weapon in the right hand
    this.weapon = makeWeapon(this.weaponId, this.inkColor.getHex());
    this.weapon.position.set(0.31, 1.0, 0.3);
    g.add(this.weapon);

    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  buildSquid() {
    const ink = mat(this.inkColor.getHex(), 0.28, 0.05, this.inkColor.getHex(), 0.35);
    const g = this.squid;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), ink);
    body.scale.set(1, 0.85, 1.55);
    body.position.set(0, 0.3, -0.05);
    g.add(body);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.85, 14), ink);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.3, -0.66);
    g.add(tail);
    this.squidTail = tail;

    this.fins = [];
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 8), ink);
      fin.rotation.z = side * 1.25;
      fin.rotation.x = -0.25;
      fin.position.set(side * 0.3, 0.3, -0.2);
      g.add(fin);
      this.fins.push(fin);
    }

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mat(0xffffff, 0.3));
      eye.position.set(side * 0.16, 0.38, 0.22);
      g.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(0x141024, 0.2));
      pupil.position.set(side * 0.17, 0.38, 0.28);
      g.add(pupil);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  }

  buildNameplate() {
    const tex = makeNameTexture(this.name, `#${new THREE.Color(TEAMS[this.team].glow).getHexString()}`);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(1.9, 0.48, 1);
    spr.position.y = 2.15;
    spr.renderOrder = 5;
    this.nameplate = spr;
    this.root.add(spr);
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.humanoid.remove(this.weapon);
    this.weapon = makeWeapon(id, this.inkColor.getHex());
    this.weapon.position.set(0.31, 1.0, 0.3);
    this.humanoid.add(this.weapon);
  }

  setSquid(on) {
    if (this.squidMode === on) return;
    this.squidMode = on;
    this.humanoid.visible = !on;
    this.squid.visible = on;
  }

  setVisible(v) {
    this.root.visible = v;
  }

  kick() { this.fireKick = 1; }

  // state: { speed, grounded, pitch, submerged, firing }
  update(dt, state = {}) {
    this.t += dt;
    const speed = state.speed || 0;
    this.fireKick = Math.max(0, this.fireKick - dt * 6);

    if (this.squidMode) {
      const bob = state.submerged ? -0.16 : 0;
      this.squid.position.y = bob + Math.sin(this.t * 9 + this.phase) * (speed > 1 ? 0.06 : 0.02);
      this.squid.rotation.z = Math.sin(this.t * 6 + this.phase) * 0.12 * Math.min(1, speed / 6);
      this.squid.rotation.x = -Math.min(0.35, speed * 0.03);
      const flap = Math.sin(this.t * 12 + this.phase) * 0.2 * Math.min(1, speed / 5 + 0.2);
      this.fins[0].rotation.z = 1.25 + flap;
      this.fins[1].rotation.z = -1.25 - flap;
      this.nameplate.visible = !state.submerged && !this.isLocal;
      return;
    }

    const walk = Math.min(1, speed / 5.4);
    const freq = 9 + walk * 5;
    const swing = Math.sin(this.t * freq + this.phase) * 0.75 * walk;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.5 - 0.15;

    // Right arm aims the weapon.
    const pitch = state.pitch || 0;
    const aim = -pitch * 0.9 - 0.9 - this.fireKick * 0.35;
    this.arms[1].rotation.x = aim;
    this.weapon.rotation.x = aim + 0.85;
    this.weapon.position.z = 0.3 - this.fireKick * 0.12;

    const bob = Math.abs(Math.sin(this.t * freq + this.phase)) * 0.045 * walk;
    this.torso.position.y = 0.88 + bob;
    this.head.position.y = 1.34 + bob;
    this.head.rotation.x = pitch * 0.35;

    if (!state.grounded) {
      this.legs[0].rotation.x = 0.5;
      this.legs[1].rotation.x = -0.25;
    }

    for (let i = 0; i < this.tentacles.length; i++) {
      const t = this.tentacles[i];
      t.rotation.x = 0.6 + Math.sin(this.t * 3 + i * 0.9 + this.phase) * 0.14 + walk * 0.2;
      t.rotation.y = Math.sin(this.t * 2.2 + i) * 0.12;
    }
    this.nameplate.visible = !this.isLocal;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.geometry?.dispose?.();
        if (o.material?.map) o.material.map.dispose?.();
        o.material?.dispose?.();
      }
    });
  }
}
