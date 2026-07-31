// Ink rendering. Every paintable surface owns a render target; splats are
// stamped into it as textured quads in the surface's own UV space. The
// gameplay lattice in shared/world.js is updated by the same call, so what you
// see is exactly what the server scores.

import * as THREE from 'three';
import { makeSplatMasks } from './textures.js';
import { TEAMS } from '../shared/constants.js';

export class PaintSystem {
  constructor(renderer, world, scene) {
    this.renderer = renderer;
    this.world = world;
    this.scene = scene;
    this.masks = makeSplatMasks(10);
    this.targets = new Map();
    this.meshes = [];
    this.teamColors = TEAMS.map((t) => new THREE.Color(t.ink));

    // Stamping rig.
    this.stampScene = new THREE.Scene();
    this.stampCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    this.stampMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      toneMapped: false,
    });
    this.stampQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.stampMat);
    this.stampQuad.frustumCulled = false;
    this.stampScene.add(this.stampQuad);

    this.build();
  }

  build() {
    if (!this.world.paintable) return;
    const up = new THREE.Vector3();
    for (const s of this.world.surfaces) {
      const rt = new THREE.WebGLRenderTarget(s.texW, s.texH, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        depthBuffer: false,
        stencilBuffer: false,
      });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      rt.texture.anisotropy = 2;
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, false, false);
      this.renderer.setRenderTarget(null);
      this.targets.set(s.id, rt);

      const geo = new THREE.PlaneGeometry(s.su, s.sv);
      const mat = new THREE.MeshStandardMaterial({
        map: rt.texture,
        transparent: true,
        depthWrite: false,
        roughness: 0.22,
        metalness: 0.0,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: rt.texture,
        emissiveIntensity: 0.5,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // Basis: local +X -> u, +Y -> v, +Z -> n.
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(s.u.x, s.u.y, s.u.z),
        new THREE.Vector3(s.v.x, s.v.y, s.v.z),
        new THREE.Vector3(s.n.x, s.n.y, s.n.z),
      );
      mesh.quaternion.setFromRotationMatrix(m);
      up.set(s.center.x + s.n.x * 0.016, s.center.y + s.n.y * 0.016, s.center.z + s.n.z * 0.016);
      mesh.position.copy(up);
      mesh.renderOrder = 2;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      mesh.userData.surface = s;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  // Paint the world and stamp the matching decals. Returns the number of
  // lattice cells that changed hands (used for local score feedback).
  splat(pos, radius, team, seed = 0) {
    const hits = this.world.splat(pos, radius, team);
    if (!hits.length) return 0;
    const renderer = this.renderer;
    const prevAuto = renderer.autoClear;
    const prevTarget = renderer.getRenderTarget();
    renderer.autoClear = false;
    this.stampMat.color.copy(this.teamColors[team] || this.teamColors[0]);

    let changed = 0;
    let n = 0;
    for (const h of hits) {
      changed += h.changed;
      const s = h.s;
      const rt = this.targets.get(s.id);
      if (!rt) continue;
      const r = hash(seed + n * 977);
      n++;
      this.stampMat.map = this.masks[Math.floor(r * this.masks.length) % this.masks.length];
      this.stampMat.needsUpdate = true;

      const cam = this.stampCam;
      cam.left = 0; cam.right = s.su; cam.bottom = 0; cam.top = s.sv;
      cam.updateProjectionMatrix();

      // Splat masks paint a little wider than the gameplay radius so the ink
      // reads as organic rather than as a hard circle.
      const size = h.r * 2 * 1.28;
      this.stampQuad.position.set(h.u, h.v, 0);
      this.stampQuad.scale.set(size * (0.9 + r * 0.25), size * (0.9 + hash(seed + n * 31) * 0.25), 1);
      this.stampQuad.rotation.z = r * Math.PI * 2;
      this.stampQuad.updateMatrixWorld(true);

      renderer.setRenderTarget(rt);
      renderer.render(this.stampScene, cam);
    }

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    return changed;
  }

  clear() {
    this.world.clearInk();
    const prevTarget = this.renderer.getRenderTarget();
    for (const rt of this.targets.values()) {
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    for (const rt of this.targets.values()) rt.dispose();
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.targets.clear();
    this.meshes.length = 0;
  }
}

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
