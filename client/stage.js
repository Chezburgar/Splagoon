// Builds the visible stage: solid geometry, decorative props, sky, water and
// lighting. Ink decals are layered on top by PaintSystem.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeSurfaceTexture, makeSignTexture, makeSkyTexture } from './textures.js';
import { rampBasis } from '../shared/world.js';

const STYLE_MAT = {
  deck: { rough: 0.85, metal: 0.02 },
  plate: { rough: 0.7, metal: 0.08 },
  metal: { rough: 0.35, metal: 0.65 },
  crate: { rough: 0.9, metal: 0.0 },
  spawn: { rough: 0.6, metal: 0.15 },
  plaza: { rough: 0.8, metal: 0.03 },
  tower: { rough: 0.5, metal: 0.25 },
  building: { rough: 0.65, metal: 0.1 },
  portal: { rough: 0.3, metal: 0.4, emissive: 0x3a2f8f, emissiveIntensity: 0.9 },
  shopA: { rough: 0.7, metal: 0.05 },
  shopB: { rough: 0.7, metal: 0.05 },
  bounds: { rough: 0.9, metal: 0.05 },
  concrete: { rough: 0.9, metal: 0.0 },
};

export class Stage {
  constructor(scene, world, mapDef) {
    this.scene = scene;
    this.world = world;
    this.map = mapDef;
    this.materials = new Map();
    this.group = new THREE.Group();
    this.animated = [];
    scene.add(this.group);

    this.buildSky();
    this.buildLights();
    this.buildGeometry();
    this.buildProps();
    if (mapDef.kind === 'battle') this.buildWater();
    else this.buildSkyline();
  }

  material(style) {
    if (this.materials.has(style)) return this.materials.get(style);
    const cfg = STYLE_MAT[style] || STYLE_MAT.concrete;
    const mat = new THREE.MeshStandardMaterial({
      map: makeSurfaceTexture(style),
      roughness: cfg.rough,
      metalness: cfg.metal,
      emissive: new THREE.Color(cfg.emissive || 0x000000),
      emissiveIntensity: cfg.emissiveIntensity || 0,
    });
    this.materials.set(style, mat);
    return mat;
  }

  buildSky() {
    const sky = this.map.sky;
    const tex = makeSkyTexture(sky.top, sky.bottom);
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;
    this.scene.add(mesh);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(sky.fog), sky.fogDensity);
    this.scene.background = new THREE.Color(sky.fog);
    this.skyMesh = mesh;

    // A few soft clouds/blimps to give the sky depth.
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, fog: false });
    for (let i = 0; i < 14; i++) {
      const s = 20 + Math.random() * 46;
      const c = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), cloudMat);
      const a = Math.random() * Math.PI * 2;
      const r = 150 + Math.random() * 140;
      c.position.set(Math.cos(a) * r, 60 + Math.random() * 70, Math.sin(a) * r);
      c.scale.set(1.8, 0.5, 1);
      c.renderOrder = -1;
      this.scene.add(c);
    }
  }

  buildLights() {
    const sky = this.map.sky;
    const hemi = new THREE.HemisphereLight(new THREE.Color(sky.bottom), new THREE.Color(0x30264f), 0.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3e0, 1.45);
    const b = this.map.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    sun.position.set(cx + 60, 96, cz + 42);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    this.fitShadowCamera(sun, b);
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.04;

    const rim = new THREE.DirectionalLight(0x88b4ff, 0.35);
    rim.position.set(-40, 30, -30);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  }

  // Size the shadow frustum to the stage's light-space bounding box, otherwise
  // ground outside the frustum renders as a hard dark band.
  fitShadowCamera(sun, b) {
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    const view = new THREE.Matrix4().lookAt(sun.position, sun.target.position, new THREE.Vector3(0, 1, 0));
    view.setPosition(sun.position);
    view.invert();
    const p = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const pad = 6;
    for (const x of [b.minX - pad, b.maxX + pad]) {
      for (const z of [b.minZ - pad, b.maxZ + pad]) {
        for (const y of [-6, 26]) {
          p.set(x, y, z).applyMatrix4(view);
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
      }
    }
    const cam = sun.shadow.camera;
    cam.left = minX; cam.right = maxX;
    cam.bottom = minY; cam.top = maxY;
    cam.near = Math.max(0.5, -maxZ - 2);
    cam.far = -minZ + 2;
    cam.updateProjectionMatrix();
  }

  buildGeometry() {
    for (const part of this.map.parts) {
      if (part.style === 'bounds') { this.addBounds(part); continue; }
      if (part.type === 'box') this.addBox(part);
      else if (part.type === 'ramp') this.addRamp(part);
    }
  }

  addBox(part) {
    const { sx, sy, sz } = part;
    const small = Math.max(sx, sy, sz) < 6;
    const geo = small
      ? new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(0.14, Math.min(sx, sy, sz) * 0.12))
      : new THREE.BoxGeometry(sx, sy, sz);
    scaleBoxUVs(geo, sx, sy, sz, 3.2);
    const mesh = new THREE.Mesh(geo, this.material(part.style));
    mesh.position.set(part.x, part.y + sy / 2, part.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Painted trim strip along the top edge of tall blocks reads as a ledge.
    if (sy > 1.4 && sy < 12 && part.style !== 'plaza') {
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(sx + 0.06, 0.12, sz + 0.06),
        new THREE.MeshStandardMaterial({ color: 0x2b2740, roughness: 0.5 }),
      );
      trim.position.set(part.x, part.y + sy - 0.06, part.z);
      trim.castShadow = false;
      this.group.add(trim);
    }
  }

  addBounds(part) {
    const geo = new THREE.BoxGeometry(part.sx, part.sy, part.sz);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2648, roughness: 0.6, metalness: 0.2,
      transparent: true, opacity: 0.92,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(part.x, part.y + part.sy / 2, part.z);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // Glowing hazard line along the top.
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(part.sx + 0.1, 0.22, part.sz + 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffe14d }),
    );
    line.position.set(part.x, part.y + part.sy, part.z);
    this.group.add(line);
  }

  addRamp(part) {
    const b = rampBasis(part);
    const geo = wedgeGeometry(part);
    const mesh = new THREE.Mesh(geo, this.material(part.style));
    mesh.position.set(part.x, part.y, part.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(600, 600, 40, 40);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color('#124a70') },
        uColorB: { value: new THREE.Color('#2f9fc4') },
      },
      vertexShader: `
        uniform float uTime;
        varying float vWave;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec3 p = position;
          float w = sin(p.x * 0.09 + uTime * 0.9) * 0.5 + sin(p.y * 0.13 - uTime * 1.3) * 0.35
                  + sin((p.x + p.y) * 0.05 + uTime * 0.6) * 0.3;
          p.z += w;
          vWave = w;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColorA; uniform vec3 uColorB; uniform float uTime;
        varying float vWave; varying vec2 vUv; varying vec3 vWorld;
        void main() {
          float f = smoothstep(-1.0, 1.0, vWave);
          vec3 c = mix(uColorA, uColorB, f);
          // Soft crests instead of a high frequency sparkle, which aliased badly.
          float crest = smoothstep(0.55, 1.0, vWave);
          c = mix(c, c + vec3(0.10, 0.14, 0.16), crest);
          // Fade toward the fog colour in the distance so the sea meets the sky.
          float d = clamp(length(vWorld.xz) / 260.0, 0.0, 1.0);
          c = mix(c, vec3(0.56, 0.78, 0.87), d * d);
          gl_FragColor = vec4(c, 0.94);
        }`,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -3.4;
    this.scene.add(mesh);
    this.animated.push((t) => { mat.uniforms.uTime.value = t; });
  }

  buildSkyline() {
    // Distant city ring for the plaza.
    const colors = [0x4a3f77, 0x3b3364, 0x5b4b8a, 0x2f2a52];
    const group = new THREE.Group();
    for (let i = 0; i < 54; i++) {
      const a = (i / 54) * Math.PI * 2 + Math.random() * 0.06;
      const r = 62 + Math.random() * 60;
      const h = 14 + Math.random() * 58;
      const w = 8 + Math.random() * 14;
      const geo = new THREE.BoxGeometry(w, h, w);
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length], roughness: 0.8,
        emissive: new THREE.Color().setHSL(Math.random(), 0.7, 0.25),
        emissiveIntensity: 0.35,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
      group.add(m);
    }
    this.scene.add(group);
  }

  buildProps() {
    for (const p of this.map.props || []) {
      const obj = this.makeProp(p);
      if (!obj) continue;
      obj.position.set(p.x, p.y, p.z);
      obj.rotation.y = p.rot || 0;
      this.group.add(obj);
    }
  }

  makeProp(p) {
    const g = new THREE.Group();
    const paint = (c, rough = 0.6, metal = 0.2) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });

    switch (p.type) {
      case 'crane': {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 1), paint(0xd8b23a, 0.5, 0.5));
        leg.position.y = 8; leg.castShadow = true; g.add(leg);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(20, 0.8, 1.2), paint(0xd8b23a, 0.5, 0.5));
        arm.position.set(5, 15.6, 0); arm.castShadow = true; g.add(arm);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2), paint(0x2f2b48, 0.4, 0.3));
        cab.position.set(-3.6, 14.4, 0); g.add(cab);
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 8), paint(0x222, 0.9, 0.1));
        cable.position.set(12, 11.4, 0); g.add(cable);
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.14, 8, 16), paint(0x999, 0.4, 0.8));
        hook.position.set(12, 7.2, 0); g.add(hook);
        break;
      }
      case 'container': {
        const body = new THREE.Mesh(new RoundedBoxGeometry(7, 3.2, 3, 2, 0.1), paint(p.color || 0xcc5544, 0.75, 0.35));
        body.position.y = 1.6; body.castShadow = true; body.receiveShadow = true; g.add(body);
        for (let i = -3; i <= 3; i++) {
          const rib = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.0, 3.06), paint(0x000000, 0.9, 0.1));
          rib.material.opacity = 0.25; rib.material.transparent = true;
          rib.position.set(i * 0.95, 1.6, 0); g.add(rib);
        }
        break;
      }
      case 'buoy': {
        const body = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), paint(0xff5b1f, 0.5, 0.1));
        body.position.y = 1; g.add(body);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4), paint(0xdddddd, 0.5, 0.4));
        pole.position.y = 2.6; g.add(pole);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe14d }));
        lamp.position.y = 3.9; g.add(lamp);
        this.animated.push((t) => { g.position.y = p.y + Math.sin(t * 1.4 + p.x) * 0.22; g.rotation.z = Math.sin(t * 0.8 + p.z) * 0.06; });
        break;
      }
      case 'banner': {
        const tex = makeSignTexture('SPLAGOON', '#ffe14d', 512, 128);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.2),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
        m.position.y = 2; g.add(m);
        break;
      }
      case 'lamp': {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.5), paint(0x2a2740, 0.6, 0.5));
        pole.position.y = 3.25; pole.castShadow = true; g.add(pole);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));
        head.position.y = 6.7; g.add(head);
        const light = new THREE.PointLight(0xffd9a0, 12, 18, 2);
        light.position.y = 6.5; g.add(light);
        break;
      }
      case 'sign': case 'shopSign': {
        const tex = makeSignTexture(p.text || 'SHOP', p.color || '#12cdf0', 512, 160);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(p.type === 'sign' ? 9 : 6.4, p.type === 'sign' ? 2.8 : 2),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
        g.add(m);
        const glow = new THREE.PointLight(new THREE.Color(p.color || '#12cdf0'), 14, 22, 2);
        glow.position.z = 1.5; g.add(glow);
        break;
      }
      case 'jumbotron': {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(14, 6.4, 0.8), paint(0x171331, 0.5, 0.4));
        g.add(frame);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(13, 5.6),
          new THREE.MeshBasicMaterial({ map: makeSignTexture('TURF WAR', '#ff5b1f', 640, 256), transparent: true }));
        screen.position.z = 0.45; g.add(screen);
        this.animated.push((t) => {
          screen.material.opacity = 0.75 + Math.sin(t * 3) * 0.25;
          screen.material.transparent = true;
        });
        break;
      }
      case 'tree': {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 4.2), paint(0x5b4632, 0.9, 0));
        trunk.position.y = 2.1; trunk.castShadow = true; g.add(trunk);
        for (let i = 0; i < 3; i++) {
          const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9 - i * 0.35, 1), paint(0x54c98a, 0.85, 0));
          blob.position.set((Math.random() - 0.5) * 1.2, 4.4 + i * 1.1, (Math.random() - 0.5) * 1.2);
          blob.castShadow = true;
          g.add(blob);
        }
        break;
      }
      default: return null;
    }
    return g;
  }

  update(t) {
    for (const fn of this.animated) fn(t);
  }
}

/* ---------------------------- geometry helpers -------------------------- */

// BoxGeometry lays out faces px, nx, py, ny, pz, nz; give each one world-scaled
// UVs so a shared tiling texture keeps a constant density.
function scaleBoxUVs(geo, sx, sy, sz, unit) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  const faceSizes = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  const per = uv.count / 6;
  for (let f = 0; f < 6; f++) {
    const [w, h] = faceSizes[f];
    for (let i = 0; i < per; i++) {
      const idx = f * per + i;
      uv.setXY(idx, uv.getX(idx) * (w / unit), uv.getY(idx) * (h / unit));
    }
  }
  uv.needsUpdate = true;
}

// Triangular prism matching the ramp collider. Local origin is the part's
// centre-bottom, matching World's ramp bounds.
function wedgeGeometry(part) {
  const { sx, sy, sz, dir } = part;
  const hx = sx / 2, hz = sz / 2;
  // Corners of the footprint, with the "high" edge determined by dir.
  const lowY = 0, highY = sy;
  let a, b, c, d; // a,b = low edge; c,d = high edge (same order)
  if (dir === '+z') {
    a = [-hx, lowY, -hz]; b = [hx, lowY, -hz]; c = [hx, highY, hz]; d = [-hx, highY, hz];
  } else if (dir === '-z') {
    a = [hx, lowY, hz]; b = [-hx, lowY, hz]; c = [-hx, highY, -hz]; d = [hx, highY, -hz];
  } else if (dir === '+x') {
    a = [-hx, lowY, hz]; b = [-hx, lowY, -hz]; c = [hx, highY, -hz]; d = [hx, highY, hz];
  } else {
    a = [hx, lowY, -hz]; b = [hx, lowY, hz]; c = [-hx, highY, hz]; d = [-hx, highY, -hz];
  }
  const a0 = [a[0], 0, a[2]], b0 = [b[0], 0, b[2]], c0 = [c[0], 0, c[2]], d0 = [d[0], 0, d[2]];

  const pos = [];
  const uvs = [];
  const slopeLen = Math.hypot(sy, dir === '+z' || dir === '-z' ? sz : sx);
  const width = dir === '+z' || dir === '-z' ? sx : sz;

  const tri = (p, q, r, uvp, uvq, uvr) => {
    pos.push(...p, ...q, ...r);
    uvs.push(...uvp, ...uvq, ...uvr);
  };
  // slope
  tri(a, b, c, [0, 0], [width / 3.2, 0], [width / 3.2, slopeLen / 3.2]);
  tri(a, c, d, [0, 0], [width / 3.2, slopeLen / 3.2], [0, slopeLen / 3.2]);
  // bottom
  tri(a0, d0, c0, [0, 0], [1, 0], [1, 1]);
  tri(a0, c0, b0, [0, 0], [1, 1], [0, 1]);
  // back (high) face
  tri(d0, c0, c, [0, 0], [width / 3.2, 0], [width / 3.2, sy / 3.2]);
  tri(d0, c, d, [0, 0], [width / 3.2, sy / 3.2], [0, sy / 3.2]);
  // sides
  tri(a0, a, d, [0, 0], [0, sy / 3.2], [1, sy / 3.2]);
  tri(a0, d, d0, [0, 0], [1, sy / 3.2], [1, 0]);
  tri(b0, c0, c, [0, 0], [1, 0], [1, sy / 3.2]);
  tri(b0, c, b, [0, 0], [1, sy / 3.2], [0, sy / 3.2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}
