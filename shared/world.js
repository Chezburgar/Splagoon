// The world model: collision, raycasting and the ink lattice.
//
// The exact same code runs on the server (authoritative scoring, projectile
// hits, bot navigation) and in the browser (movement prediction, effects,
// minimap), so a splat resolves identically on both sides and only the splat
// *event* has to travel over the wire.

import { PAINT, MOVE } from './constants.js';

const EPS = 1e-6;

/* --------------------------------- math -------------------------------- */

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vadd = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const vsub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const vscale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vlen = (a) => Math.sqrt(vdot(a, a));
export const vdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const vdistSq = (a, b) => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};
export function vnorm(a) {
  const l = vlen(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
}
export const vcross = (a, b) => v3(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
);

/* ------------------------------- surfaces ------------------------------ */

let surfaceUid = 0;

function makeSurface(part, kind, o, u, uLen, v, vLen, n, opts) {
  const cellsU = Math.max(1, Math.round(uLen * PAINT.gridPerMeter));
  const cellsV = Math.max(1, Math.round(vLen * PAINT.gridPerMeter));
  return {
    id: surfaceUid++,
    part, kind, style: part.style,
    o, u: vnorm(u), v: vnorm(v), n: vnorm(n),
    su: uLen, sv: vLen,
    scoring: !!opts.scoring,
    climb: !!opts.climb,
    // gameplay lattice
    gw: cellsU, gh: cellsV,
    grid: new Uint8Array(cellsU * cellsV),
    painted: [0, 0],
    total: cellsU * cellsV,
    // centre + bounding radius for fast rejection
    center: v3(
      o.x + u.x * uLen * 0.5 + v.x * vLen * 0.5,
      o.y + u.y * uLen * 0.5 + v.y * vLen * 0.5,
      o.z + u.z * uLen * 0.5 + v.z * vLen * 0.5,
    ),
    bound: Math.hypot(uLen, vLen) * 0.5,
    // texture size for the renderer
    texW: Math.min(PAINT.maxTexSize, Math.max(32, Math.round(uLen * PAINT.texelsPerMeter))),
    texH: Math.min(PAINT.maxTexSize, Math.max(32, Math.round(vLen * PAINT.texelsPerMeter))),
    dirty: true,
  };
}

function boxSurfaces(part, out) {
  const { x, y, z, sx, sy, sz } = part;
  const hx = sx / 2, hz = sz / 2;
  const opts = { scoring: part.scoring, climb: part.climb };
  if (part.top) {
    out.push(makeSurface(part, 'top',
      v3(x - hx, y + sy, z - hz),
      v3(1, 0, 0), sx,
      v3(0, 0, 1), sz,
      v3(0, 1, 0), opts));
  }
  if (part.sides && sy > 0.05) {
    const sideOpts = { scoring: false, climb: part.climb };
    out.push(makeSurface(part, 'side', v3(x + hx, y, z + hz), v3(0, 0, -1), sz, v3(0, 1, 0), sy, v3(1, 0, 0), sideOpts));
    out.push(makeSurface(part, 'side', v3(x - hx, y, z - hz), v3(0, 0, 1), sz, v3(0, 1, 0), sy, v3(-1, 0, 0), sideOpts));
    out.push(makeSurface(part, 'side', v3(x - hx, y, z + hz), v3(1, 0, 0), sx, v3(0, 1, 0), sy, v3(0, 0, 1), sideOpts));
    out.push(makeSurface(part, 'side', v3(x + hx, y, z - hz), v3(-1, 0, 0), sx, v3(0, 1, 0), sy, v3(0, 0, -1), sideOpts));
  }
}

// Slope basis for a ramp: `dir` is the direction of ascent.
export function rampBasis(part) {
  const { x, y, z, sx, sy, sz, dir } = part;
  const hx = sx / 2, hz = sz / 2;
  let o, u, uLen, vDir, vLen, n;
  if (dir === '+z') {
    o = v3(x - hx, y, z - hz); u = v3(1, 0, 0); uLen = sx;
    vDir = vnorm(v3(0, sy, sz)); vLen = Math.hypot(sy, sz);
    n = vnorm(v3(0, sz, -sy));
  } else if (dir === '-z') {
    o = v3(x + hx, y, z + hz); u = v3(-1, 0, 0); uLen = sx;
    vDir = vnorm(v3(0, sy, -sz)); vLen = Math.hypot(sy, sz);
    n = vnorm(v3(0, sz, sy));
  } else if (dir === '+x') {
    o = v3(x - hx, y, z + hz); u = v3(0, 0, -1); uLen = sz;
    vDir = vnorm(v3(sx, sy, 0)); vLen = Math.hypot(sy, sx);
    n = vnorm(v3(-sy, sx, 0));
  } else { // '-x'
    o = v3(x + hx, y, z - hz); u = v3(0, 0, 1); uLen = sz;
    vDir = vnorm(v3(-sx, sy, 0)); vLen = Math.hypot(sy, sx);
    n = vnorm(v3(sy, sx, 0));
  }
  return { o, u, uLen, vDir, vLen, n };
}

function rampSurfaces(part, out) {
  if (part.paint === false) return;
  const b = rampBasis(part);
  out.push(makeSurface(part, 'ramp', b.o, b.u, b.uLen, b.vDir, b.vLen, b.n,
    { scoring: part.scoring, climb: false }));
}

/* --------------------------------- world ------------------------------- */

export class World {
  constructor(mapDef) {
    this.map = mapDef;
    this.paintable = mapDef.paintable !== false;
    this.boxes = [];
    this.ramps = [];
    this.surfaces = [];
    this.scoringTotal = 0;

    for (const part of mapDef.parts) {
      if (part.type === 'box') {
        if (part.solid !== false) {
          this.boxes.push({
            part,
            min: v3(part.x - part.sx / 2, part.y, part.z - part.sz / 2),
            max: v3(part.x + part.sx / 2, part.y + part.sy, part.z + part.sz / 2),
          });
        }
        if (this.paintable) boxSurfaces(part, this.surfaces);
        else if (part.top) boxSurfaces({ ...part, sides: false }, this.surfaces);
      } else if (part.type === 'ramp') {
        const b = rampBasis(part);
        this.ramps.push({
          part, basis: b,
          min: v3(part.x - part.sx / 2, part.y, part.z - part.sz / 2),
          max: v3(part.x + part.sx / 2, part.y + part.sy, part.z + part.sz / 2),
        });
        if (this.paintable) rampSurfaces(part, this.surfaces);
      }
    }

    for (const s of this.surfaces) if (s.scoring) this.scoringTotal += s.total;

    // Uniform grid over XZ for surface + collider lookups.
    this.buildIndex();
    this.teamCells = [0, 0];
    this.splatSeq = 0;
  }

  buildIndex() {
    const b = this.map.bounds;
    this.cell = 6;
    this.gx0 = Math.floor((b.minX - 8) / this.cell);
    this.gz0 = Math.floor((b.minZ - 8) / this.cell);
    this.gw = Math.ceil((b.maxX + 8) / this.cell) - this.gx0 + 1;
    this.gh = Math.ceil((b.maxZ + 8) / this.cell) - this.gz0 + 1;
    this.index = new Array(this.gw * this.gh);
    for (let i = 0; i < this.index.length; i++) this.index[i] = [];
    for (const s of this.surfaces) {
      const r = s.bound + 1;
      const x0 = Math.floor((s.center.x - r) / this.cell) - this.gx0;
      const x1 = Math.floor((s.center.x + r) / this.cell) - this.gx0;
      const z0 = Math.floor((s.center.z - r) / this.cell) - this.gz0;
      const z1 = Math.floor((s.center.z + r) / this.cell) - this.gz0;
      for (let gz = Math.max(0, z0); gz <= Math.min(this.gh - 1, z1); gz++) {
        for (let gx = Math.max(0, x0); gx <= Math.min(this.gw - 1, x1); gx++) {
          this.index[gz * this.gw + gx].push(s);
        }
      }
    }
  }

  surfacesNear(p, radius) {
    const out = [];
    const x0 = Math.floor((p.x - radius) / this.cell) - this.gx0;
    const x1 = Math.floor((p.x + radius) / this.cell) - this.gx0;
    const z0 = Math.floor((p.z - radius) / this.cell) - this.gz0;
    const z1 = Math.floor((p.z + radius) / this.cell) - this.gz0;
    const seen = new Set();
    for (let gz = Math.max(0, z0); gz <= Math.min(this.gh - 1, z1); gz++) {
      for (let gx = Math.max(0, x0); gx <= Math.min(this.gw - 1, x1); gx++) {
        for (const s of this.index[gz * this.gw + gx]) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          out.push(s);
        }
      }
    }
    return out;
  }

  /* ------------------------------ geometry ----------------------------- */

  pointInSolid(p, pad = 0) {
    for (const b of this.boxes) {
      if (p.x > b.min.x - pad && p.x < b.max.x + pad &&
          p.y > b.min.y - pad && p.y < b.max.y + pad &&
          p.z > b.min.z - pad && p.z < b.max.z + pad) return true;
    }
    for (const r of this.ramps) {
      if (p.x > r.min.x && p.x < r.max.x && p.z > r.min.z && p.z < r.max.z) {
        if (p.y > r.min.y - pad && p.y < this.rampHeight(r, p.x, p.z) - 0.02) return true;
      }
    }
    return false;
  }

  rampHeight(r, x, z) {
    const p = r.part;
    let t;
    if (p.dir === '+z') t = (z - r.min.z) / p.sz;
    else if (p.dir === '-z') t = (r.max.z - z) / p.sz;
    else if (p.dir === '+x') t = (x - r.min.x) / p.sx;
    else t = (r.max.x - x) / p.sx;
    return p.y + Math.max(0, Math.min(1, t)) * p.sy;
  }

  // Highest walkable surface at (x,z) that is at or below `maxY`.
  groundHeightAt(x, z, maxY = Infinity) {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) {
        if (b.max.y <= maxY && b.max.y > best) best = b.max.y;
      }
    }
    for (const r of this.ramps) {
      if (x >= r.min.x && x <= r.max.x && z >= r.min.z && z <= r.max.z) {
        const h = this.rampHeight(r, x, z);
        if (h <= maxY && h > best) best = h;
      }
    }
    return best;
  }

  // Ray vs world. Returns { t, point, normal, surface } or null.
  raycast(origin, dir, maxDist) {
    let bestT = maxDist;
    let hit = null;
    for (const b of this.boxes) {
      const t = rayAABB(origin, dir, b.min, b.max, bestT);
      if (t !== null && t < bestT && t >= 0) {
        bestT = t;
        const p = v3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
        hit = { t, point: p, normal: aabbNormal(b, p), part: b.part };
      }
    }
    for (const r of this.ramps) {
      const b = r.basis;
      const denom = vdot(dir, b.n);
      if (Math.abs(denom) > EPS) {
        const t = vdot(vsub(b.o, origin), b.n) / denom;
        if (t >= 0 && t < bestT) {
          const p = v3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
          if (p.x >= r.min.x - 0.01 && p.x <= r.max.x + 0.01 && p.z >= r.min.z - 0.01 && p.z <= r.max.z + 0.01 &&
              p.y >= r.min.y - 0.05 && p.y <= r.max.y + 0.05) {
            bestT = t;
            hit = { t, point: p, normal: b.n, part: r.part };
          }
        }
      }
    }
    return hit;
  }

  losBlocked(a, b, slack = 0.08) {
    const d = vsub(b, a);
    const dist = vlen(d);
    if (dist < 1e-4) return false;
    const dir = vscale(d, 1 / dist);
    const hit = this.raycast(a, dir, dist - slack);
    return !!hit;
  }

  /* -------------------------------- ink -------------------------------- */

  // Project a point onto a surface: local (u,v) plus signed plane distance.
  project(s, p) {
    const d = vsub(p, s.o);
    return {
      u: vdot(d, s.u),
      v: vdot(d, s.v),
      d: vdot(d, s.n),
    };
  }

  surfacePoint(s, u, v) {
    return v3(
      s.o.x + s.u.x * u + s.v.x * v,
      s.o.y + s.u.y * u + s.v.y * v,
      s.o.z + s.u.z * u + s.v.z * v,
    );
  }

  // Paint a sphere of ink. Returns the per-surface footprints so the renderer
  // can stamp matching decals. Deterministic given the same arguments.
  splat(p, radius, team, opts = {}) {
    if (!this.paintable) return [];
    const hits = [];
    const near = this.surfacesNear(p, radius + 1);
    for (const s of near) {
      if (vdistSq(p, s.center) > (radius + s.bound) * (radius + s.bound)) continue;
      const pr = this.project(s, p);
      if (Math.abs(pr.d) > radius) continue;
      // Ink only lands on the front face of a surface.
      if (pr.d < -0.05) continue;
      const r2 = Math.sqrt(Math.max(0, radius * radius - pr.d * pr.d));
      if (r2 < 0.05) continue;
      if (pr.u < -r2 || pr.u > s.su + r2 || pr.v < -r2 || pr.v > s.sv + r2) continue;

      // Cheap occlusion test against the nearest point of this surface.
      const cu = Math.max(0, Math.min(s.su, pr.u));
      const cv = Math.max(0, Math.min(s.sv, pr.v));
      const nearest = this.surfacePoint(s, cu, cv);
      const lift = v3(nearest.x + s.n.x * 0.06, nearest.y + s.n.y * 0.06, nearest.z + s.n.z * 0.06);
      if (this.losBlocked(p, lift, 0.12)) continue;

      const changed = this.rasterize(s, pr.u, pr.v, r2, team);
      hits.push({ s, u: pr.u, v: pr.v, r: r2, changed });
    }
    return hits;
  }

  rasterize(s, cu, cv, r, team) {
    const scale = s.gw / s.su;
    const scaleV = s.gh / s.sv;
    const i0 = Math.max(0, Math.floor((cu - r) * scale));
    const i1 = Math.min(s.gw - 1, Math.ceil((cu + r) * scale));
    const j0 = Math.max(0, Math.floor((cv - r) * scaleV));
    const j1 = Math.min(s.gh - 1, Math.ceil((cv + r) * scaleV));
    const value = team + 1;
    let changed = 0;
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const vy = (j + 0.5) / scaleV;
      const dv = vy - cv;
      for (let i = i0; i <= i1; i++) {
        const ux = (i + 0.5) / scale;
        const du = ux - cu;
        if (du * du + dv * dv > r2) continue;
        const idx = j * s.gw + i;
        const prev = s.grid[idx];
        if (prev === value) continue;
        // Do not paint cells buried inside geometry.
        const wp = this.surfacePoint(s, ux, vy);
        if (this.pointInSolid(v3(wp.x + s.n.x * 0.12, wp.y + s.n.y * 0.12, wp.z + s.n.z * 0.12), -0.06)) continue;
        if (prev) { s.painted[prev - 1]--; if (s.scoring) this.teamCells[prev - 1]--; }
        s.grid[idx] = value;
        s.painted[team]++;
        if (s.scoring) this.teamCells[team]++;
        changed++;
      }
    }
    if (changed) s.dirty = true;
    return changed;
  }

  coverage() {
    const total = this.scoringTotal || 1;
    return [this.teamCells[0] / total, this.teamCells[1] / total];
  }

  clearInk() {
    for (const s of this.surfaces) {
      s.grid.fill(0);
      s.painted[0] = 0; s.painted[1] = 0;
      s.dirty = true;
    }
    this.teamCells[0] = 0; this.teamCells[1] = 0;
  }

  // Which team's ink is on the floor beneath a point? -1 for bare ground.
  inkAtGround(x, y, z) {
    let bestY = -Infinity, bestTeam = -1;
    const near = this.surfacesNear(v3(x, y, z), 1.2);
    for (const s of near) {
      if (s.n.y < 0.4) continue;               // walls do not count as floor
      const pr = this.project(s, v3(x, y, z));
      if (pr.u < 0 || pr.u > s.su || pr.v < 0 || pr.v > s.sv) continue;
      const sp = this.surfacePoint(s, pr.u, pr.v);
      if (sp.y > y + 0.35 || sp.y < y - 1.4) continue;
      if (sp.y < bestY) continue;
      bestY = sp.y;
      const i = Math.min(s.gw - 1, Math.max(0, Math.floor(pr.u / s.su * s.gw)));
      const j = Math.min(s.gh - 1, Math.max(0, Math.floor(pr.v / s.sv * s.gh)));
      const val = s.grid[j * s.gw + i];
      bestTeam = val ? val - 1 : -1;
    }
    return bestTeam;
  }

  inkOnSurfaceAt(s, p) {
    const pr = this.project(s, p);
    if (pr.u < 0 || pr.u > s.su || pr.v < 0 || pr.v > s.sv) return -1;
    const i = Math.min(s.gw - 1, Math.max(0, Math.floor(pr.u / s.su * s.gw)));
    const j = Math.min(s.gh - 1, Math.max(0, Math.floor(pr.v / s.sv * s.gh)));
    const val = s.grid[j * s.gw + i];
    return val ? val - 1 : -1;
  }

  // Find a climbable wall in front of the player painted by `team`.
  climbableWall(pos, team, radius) {
    const near = this.surfacesNear(pos, radius + 1.2);
    let best = null;
    for (const s of near) {
      if (s.kind !== 'side' || !s.climb) continue;
      const pr = this.project(s, v3(pos.x, pos.y + 0.35, pos.z));
      if (pr.d < -0.02 || pr.d > radius + 0.35) continue;
      if (pr.u < -0.15 || pr.u > s.su + 0.15) continue;
      if (pr.v < -0.6 || pr.v > s.sv + 0.1) continue;
      const uu = Math.max(0, Math.min(s.su - 0.01, pr.u));
      const vv = Math.max(0, Math.min(s.sv - 0.01, pr.v));
      const i = Math.floor(uu / s.su * s.gw);
      const j = Math.floor(vv / s.sv * s.gh);
      const val = s.grid[j * s.gw + i];
      if (val !== team + 1) continue;
      if (!best || pr.d < best.d) best = { surface: s, d: pr.d, normal: s.n };
    }
    return best;
  }

  /* ------------------------------ movement ----------------------------- */

  // Sweep a vertical capsule (approximated by a circle in XZ) through the world.
  moveCharacter(pos, vel, dt, radius, height, out) {
    out.grounded = false;
    out.groundY = -Infinity;
    out.hitWall = false;

    // --- horizontal ---
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    const feet = pos.y;
    const head = pos.y + height;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.boxes) {
        if (b.max.y <= feet + MOVE.stepHeight + 0.001) continue;
        if (b.min.y >= head) continue;
        const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
          const nx = dx / d, nz = dz / d;
          const vn = vel.x * nx + vel.z * nz;
          if (vn < 0) { vel.x -= nx * vn; vel.z -= nz * vn; }
        } else {
          // Centre is inside the box: push out along the shallowest axis.
          const dxl = pos.x - b.min.x, dxr = b.max.x - pos.x;
          const dzl = pos.z - b.min.z, dzr = b.max.z - pos.z;
          const m = Math.min(dxl, dxr, dzl, dzr);
          if (m === dxl) pos.x = b.min.x - radius;
          else if (m === dxr) pos.x = b.max.x + radius;
          else if (m === dzl) pos.z = b.min.z - radius;
          else pos.z = b.max.z + radius;
        }
        out.hitWall = true;
        moved = true;
      }
      if (!moved) break;
    }

    // --- vertical ---
    pos.y += vel.y * dt;
    const ground = this.groundHeightAt(pos.x, pos.z, pos.y + MOVE.stepHeight);
    out.groundY = ground;
    if (vel.y <= 0 && ground > -Infinity && pos.y <= ground + 0.02) {
      pos.y = ground;
      vel.y = 0;
      out.grounded = true;
    }
    // ceiling
    for (const b of this.boxes) {
      if (pos.x + radius < b.min.x || pos.x - radius > b.max.x) continue;
      if (pos.z + radius < b.min.z || pos.z - radius > b.max.z) continue;
      const top = pos.y + height;
      if (top > b.min.y && pos.y < b.min.y && vel.y > 0) {
        pos.y = b.min.y - height - 0.01;
        vel.y = 0;
      }
    }
    return out;
  }
}

/* ------------------------------ ray helpers ---------------------------- */

export function rayAABB(o, d, min, max, maxT) {
  let tmin = 0, tmax = maxT;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / (d[ax] || EPS);
    let t1 = (min[ax] - o[ax]) * inv;
    let t2 = (max[ax] - o[ax]) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

function aabbNormal(b, p) {
  const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
  const ex = (b.max.x - b.min.x) / 2, ey = (b.max.y - b.min.y) / 2, ez = (b.max.z - b.min.z) / 2;
  const dx = (p.x - cx) / ex, dy = (p.y - cy) / ey, dz = (p.z - cz) / ez;
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  if (ax >= ay && ax >= az) return v3(Math.sign(dx), 0, 0);
  if (ay >= az) return v3(0, Math.sign(dy), 0);
  return v3(0, 0, Math.sign(dz));
}

// Ray vs vertical capsule, used for hit detection against players.
export function rayCapsule(o, d, base, height, radius) {
  const px = o.x - base.x, pz = o.z - base.z;
  const a = d.x * d.x + d.z * d.z;
  const b = 2 * (px * d.x + pz * d.z);
  const c = px * px + pz * pz - radius * radius;
  if (a < EPS) {
    if (c > 0) return null;
    return 0;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return null;
  const y = o.y + d.y * t;
  if (y < base.y - radius || y > base.y + height + radius) return null;
  return t;
}
