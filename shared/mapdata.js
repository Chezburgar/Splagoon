// Stage geometry, shared by the server (collision + scoring) and the client
// (rendering). Everything is built from two primitives:
//
//   box  - axis aligned box. `top`/`sides` flag which faces accept ink.
//   ramp - wedge rising along `dir` from y to y+sy. Its slope accepts ink.
//
// Stages are authored on one half and mirrored with 180 degree rotational
// symmetry so both teams get an identical approach to the middle.

const box = (x, y, z, sx, sy, sz, opts = {}) => ({
  type: 'box', x, y, z, sx, sy, sz,
  style: opts.style || 'concrete',
  top: opts.top !== false,
  sides: opts.sides !== false,
  scoring: opts.scoring !== false,
  solid: opts.solid !== false,
  climb: opts.climb !== false,
  ...opts,
});

const ramp = (x, y, z, sx, sy, sz, dir, opts = {}) => ({
  type: 'ramp', x, y, z, sx, sy, sz, dir,
  style: opts.style || 'concrete',
  scoring: opts.scoring !== false,
  paint: opts.paint !== false,
  ...opts,
});

// Rotate 180 degrees about the Y axis (through the origin).
function mirror(parts) {
  const flipDir = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
  return parts.map((p) => {
    const q = { ...p, x: -p.x, z: -p.z };
    if (q.type === 'ramp') q.dir = flipDir[p.dir];
    return q;
  });
}

function symmetric(parts) {
  return parts.concat(mirror(parts));
}

/* ------------------------------------------------------------------ */
/* Turf War stage: "Tidewater Quay"                                     */
/* ------------------------------------------------------------------ */

const ARENA_HALF_X = 26;
const ARENA_HALF_Z = 35;

const arenaShared = [
  // Main deck. Its top face is y=0, the datum every other part sits on.
  box(0, -2, 0, ARENA_HALF_X * 2, 2, ARENA_HALF_Z * 2, { style: 'deck' }),
  // Centre island.
  box(0, 0, 0, 12, 1.5, 12, { style: 'plate' }),
  ramp(0, 0, 7.75, 6, 1.5, 3.5, '-z', { style: 'plate' }),
  ramp(0, 0, -7.75, 6, 1.5, 3.5, '+z', { style: 'plate' }),
  // Centre pillar with a sniping perch.
  box(0, 1.5, 0, 4, 2.6, 4, { style: 'metal' }),
  // Long side rails that split the lanes.
  box(-15, 0, 0, 3, 2.4, 16, { style: 'crate', scoring: true }),
  box(15, 0, 0, 3, 2.4, 16, { style: 'crate', scoring: true }),
];

const arenaHalf = [
  // Spawn platform (team side, z negative).
  box(0, 0, -29, 18, 3.2, 12, { style: 'spawn' }),
  ramp(-6.5, 0, -21.25, 5, 3.2, 3.5, '-z', { style: 'spawn' }),
  ramp(6.5, 0, -21.25, 5, 3.2, 3.5, '-z', { style: 'spawn' }),
  // Spawn back wall / props.
  box(0, 3.2, -34.4, 18, 4, 1.2, { style: 'metal', top: false, scoring: false }),

  // Forward plateau in front of spawn.
  box(0, 0, -17, 14, 1.2, 6, { style: 'plate' }),
  ramp(0, 0, -12.75, 8, 1.2, 2.5, '-z', { style: 'plate' }),

  // Wing platforms.
  box(-19, 0, -12.5, 10, 2.2, 8, { style: 'plate' }),
  ramp(-19, 0, -7.25, 6, 2.2, 2.5, '-z', { style: 'plate' }),
  box(19, 0, -12.5, 10, 2.2, 8, { style: 'plate' }),
  ramp(19, 0, -7.25, 6, 2.2, 2.5, '-z', { style: 'plate' }),

  // Crates for cover in the mid approach.
  box(-8.5, 0, -8, 3, 2, 3, { style: 'crate' }),
  box(8.5, 0, -8, 3, 2, 3, { style: 'crate' }),
  box(-22, 0, -3, 4, 3.2, 5, { style: 'crate' }),
  box(22, 0, -3, 4, 3.2, 5, { style: 'crate' }),

  // Low ledges that reward wall climbing.
  box(-12.5, 0, -19, 4, 1.6, 4, { style: 'crate' }),
  box(12.5, 0, -19, 4, 1.6, 4, { style: 'crate' }),
];

const arenaBounds = [
  box(0, 0, -ARENA_HALF_Z - 1.5, ARENA_HALF_X * 2 + 6, 12, 3, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(0, 0, ARENA_HALF_Z + 1.5, ARENA_HALF_X * 2 + 6, 12, 3, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(-ARENA_HALF_X - 1.5, 0, 0, 3, 12, ARENA_HALF_Z * 2 + 6, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(ARENA_HALF_X + 1.5, 0, 0, 3, 12, ARENA_HALF_Z * 2 + 6, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
];

export const ARENA = {
  id: 'quay',
  name: 'Tidewater Quay',
  kind: 'battle',
  sky: { top: '#1d3a63', bottom: '#7fd4e8', fog: '#8fc7dd', fogDensity: 0.0075 },
  bounds: { minX: -ARENA_HALF_X, maxX: ARENA_HALF_X, minZ: -ARENA_HALF_Z, maxZ: ARENA_HALF_Z },
  killY: -12,
  // Standing on your own spawn deck makes you untouchable, so a team cannot
  // simply park on the enemy's respawn point.
  spawnZones: [
    { team: 0, minX: -9.5, maxX: 9.5, minZ: -35.5, maxZ: -22.5, minY: 3.0 },
    { team: 1, minX: -9.5, maxX: 9.5, minZ: 22.5, maxZ: 35.5, minY: 3.0 },
  ],
  parts: [...arenaShared, ...symmetric(arenaHalf), ...arenaBounds],
  spawns: [
    // Team Alpha spawns on the -Z side facing +Z.
    { team: 0, points: [
      { x: -5, y: 3.3, z: -29, yaw: 0 },
      { x: -1.7, y: 3.3, z: -29, yaw: 0 },
      { x: 1.7, y: 3.3, z: -29, yaw: 0 },
      { x: 5, y: 3.3, z: -29, yaw: 0 },
    ] },
    { team: 1, points: [
      { x: 5, y: 3.3, z: 29, yaw: Math.PI },
      { x: 1.7, y: 3.3, z: 29, yaw: Math.PI },
      { x: -1.7, y: 3.3, z: 29, yaw: Math.PI },
      { x: -5, y: 3.3, z: 29, yaw: Math.PI },
    ] },
  ],
  // Purely decorative props for the client.
  props: [
    ...symmetric([
      { type: 'crane', x: -24, y: 0, z: -26, rot: 0.4 },
      { type: 'container', x: -24.5, y: 0, z: -20, rot: 0.1, color: '#e2574c' },
      { type: 'container', x: 24.5, y: 0, z: -20, rot: -0.1, color: '#4ca3e2' },
      { type: 'buoy', x: -30, y: -1.4, z: -12, rot: 0 },
      { type: 'buoy', x: 31, y: -1.4, z: -20, rot: 0 },
      { type: 'banner', x: 0, y: 3.2, z: -34.2, rot: 0, team: 0 },
    ]),
    { type: 'lamp', x: -15, y: 2.4, z: -8, rot: 0 },
    { type: 'lamp', x: 15, y: 2.4, z: 8, rot: 0 },
  ],
};

/* ------------------------------------------------------------------ */
/* Turf War stage: "Cinder Skatepark"                                   */
/* ------------------------------------------------------------------ */

const PARK_HALF_X = 24;
const PARK_HALF_Z = 34;

const parkShared = [
  // Ground.
  box(0, -2, 0, PARK_HALF_X * 2, 2, PARK_HALF_Z * 2, { style: 'plaza' }),
  // Centre bowl: two quarter pipes facing each other across a low island.
  box(0, 0, 0, 16, 1.0, 9, { style: 'plate' }),
  ramp(0, 0, -6.75, 16, 1.0, 4.5, '+z', { style: 'plate' }),
  ramp(0, 0, 6.75, 16, 1.0, 4.5, '-z', { style: 'plate' }),
  // Grind box on top of the island.
  box(0, 1.0, 0, 5, 1.4, 5, { style: 'metal' }),
  // Half pipes on the flanks, tall enough to need a climb or a ramp.
  box(-19, 0, 0, 8, 3.4, 18, { style: 'crate' }),
  ramp(-13.5, 0, -6, 3, 3.4, 6, '-x', { style: 'crate' }),
  box(19, 0, 0, 8, 3.4, 18, { style: 'crate' }),
  ramp(13.5, 0, 6, 3, 3.4, 6, '+x', { style: 'crate' }),
];

const parkHalf = [
  // Spawn deck.
  box(0, 0, -28, 16, 2.6, 10, { style: 'spawn' }),
  ramp(0, 0, -21.25, 8, 2.6, 3.5, '-z', { style: 'spawn' }),
  box(0, 2.6, -33.2, 16, 3.6, 1.6, { style: 'metal', top: false, scoring: false }),

  // Funbox in the approach lane.
  box(0, 0, -14, 9, 1.2, 5, { style: 'plate' }),
  ramp(-6.25, 0, -14, 3.5, 1.2, 5, '+x', { style: 'plate' }),
  ramp(6.25, 0, -14, 3.5, 1.2, 5, '-x', { style: 'plate' }),

  // Side ledges linking the flanks to the middle.
  box(-13, 0, -20, 6, 1.8, 5, { style: 'crate' }),
  box(13, 0, -20, 6, 1.8, 5, { style: 'crate' }),
  // Rails / low cover near mid.
  box(-8, 0, -7, 2.4, 1.6, 6, { style: 'metal' }),
  box(8, 0, -7, 2.4, 1.6, 6, { style: 'metal' }),
  box(-21, 0, -24, 5, 2.4, 5, { style: 'crate' }),
  box(21, 0, -24, 5, 2.4, 5, { style: 'crate' }),
];

const parkBounds = [
  box(0, 0, -PARK_HALF_Z - 1.5, PARK_HALF_X * 2 + 6, 12, 3, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(0, 0, PARK_HALF_Z + 1.5, PARK_HALF_X * 2 + 6, 12, 3, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(-PARK_HALF_X - 1.5, 0, 0, 3, 12, PARK_HALF_Z * 2 + 6, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(PARK_HALF_X + 1.5, 0, 0, 3, 12, PARK_HALF_Z * 2 + 6, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
];

export const PARK = {
  id: 'park',
  name: 'Cinder Skatepark',
  kind: 'battle',
  sky: { top: '#2b1250', bottom: '#ff9a5c', fog: '#e8a583', fogDensity: 0.0085 },
  bounds: { minX: -PARK_HALF_X, maxX: PARK_HALF_X, minZ: -PARK_HALF_Z, maxZ: PARK_HALF_Z },
  killY: -12,
  spawnZones: [
    { team: 0, minX: -8.5, maxX: 8.5, minZ: -33.5, maxZ: -22.5, minY: 2.4 },
    { team: 1, minX: -8.5, maxX: 8.5, minZ: 22.5, maxZ: 33.5, minY: 2.4 },
  ],
  parts: [...parkShared, ...symmetric(parkHalf), ...parkBounds],
  spawns: [
    { team: 0, points: [
      { x: -4.5, y: 2.7, z: -28, yaw: 0 },
      { x: -1.5, y: 2.7, z: -28, yaw: 0 },
      { x: 1.5, y: 2.7, z: -28, yaw: 0 },
      { x: 4.5, y: 2.7, z: -28, yaw: 0 },
    ] },
    { team: 1, points: [
      { x: 4.5, y: 2.7, z: 28, yaw: Math.PI },
      { x: 1.5, y: 2.7, z: 28, yaw: Math.PI },
      { x: -1.5, y: 2.7, z: 28, yaw: Math.PI },
      { x: -4.5, y: 2.7, z: 28, yaw: Math.PI },
    ] },
  ],
  props: [
    ...symmetric([
      { type: 'banner', x: 0, y: 2.6, z: -33.0, rot: 0, team: 0 },
      { type: 'tree', x: -22, y: 0, z: -30, rot: 0.4 },
      { type: 'tree', x: 22, y: 0, z: -30, rot: 1.4 },
      { type: 'shopSign', x: -23.4, y: 5.4, z: -12, rot: Math.PI / 2, color: '#ffd23f', text: 'SK8' },
    ]),
    { type: 'lamp', x: -12, y: 0, z: 0, rot: 0 },
    { type: 'lamp', x: 12, y: 0, z: 0, rot: 0 },
  ],
};

/* ------------------------------------------------------------------ */
/* Lobby town: "Inkopolis Plaza"                                        */
/* ------------------------------------------------------------------ */

const TOWN_R = 34;

const townParts = [
  // Plaza floor (top face at y=0).
  box(0, -2, 0, 76, 2, 76, { style: 'plaza', scoring: false, top: true, sides: false }),
  // Central fountain / tower base.
  box(0, 0, 0, 9, 1.1, 9, { style: 'plate', scoring: false }),
  box(0, 1.1, 0, 5.4, 9.5, 5.4, { style: 'tower', scoring: false }),
  box(0, 10.6, 0, 7.4, 1.1, 7.4, { style: 'metal', scoring: false }),
  box(0, 11.7, 0, 3.2, 4.2, 3.2, { style: 'tower', scoring: false }),

  // Deca Tower - the battle entrance, north side.
  box(0, 0, -26, 22, 15, 10, { style: 'building', scoring: false }),
  box(0, 0, -20.4, 8.5, 5.4, 1.6, { style: 'portal', scoring: false, solid: false }),
  box(0, 15, -26, 24, 1.2, 12, { style: 'metal', scoring: false }),
  box(0, 16.2, -26, 6, 6, 6, { style: 'building', scoring: false }),

  // Shop row - west.
  box(-25, 0, -6, 12, 8.5, 11, { style: 'shopA', scoring: false }),
  box(-25, 0, 10, 12, 6.5, 9, { style: 'shopB', scoring: false }),
  // Shop row - east.
  box(25, 0, -6, 12, 7.5, 11, { style: 'shopB', scoring: false }),
  box(25, 0, 10, 12, 9.5, 9, { style: 'shopA', scoring: false }),
  // South arcade.
  box(-12, 0, 27, 16, 7, 10, { style: 'shopB', scoring: false }),
  box(12, 0, 27, 16, 9, 10, { style: 'shopA', scoring: false }),

  // Street furniture / skate ledges.
  box(-11, 0, 6, 6, 1.1, 6, { style: 'plate', scoring: false }),
  ramp(-11, 0, 10.2, 6, 1.1, 2.4, '-z', { style: 'plate', scoring: false }),
  box(11, 0, -6, 6, 1.1, 6, { style: 'plate', scoring: false }),
  ramp(11, 0, -10.2, 6, 1.1, 2.4, '+z', { style: 'plate', scoring: false }),
  box(-16, 0, 18, 3, 2.2, 3, { style: 'crate', scoring: false }),
  box(16, 0, 18, 3, 2.2, 3, { style: 'crate', scoring: false }),
  box(-6, 0, 16, 10, 0.8, 3, { style: 'crate', scoring: false }),
  box(7, 0, 16, 10, 0.8, 3, { style: 'crate', scoring: false }),

  // Outer wall ring.
  box(0, 0, -TOWN_R - 4.5, 90, 16, 3, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(0, 0, TOWN_R + 4.5, 90, 16, 3, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(-TOWN_R - 4.5, 0, 0, 3, 16, 90, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
  box(TOWN_R + 4.5, 0, 0, 3, 16, 90, { style: 'bounds', top: false, sides: false, scoring: false, climb: false }),
];

export const TOWN = {
  id: 'plaza',
  name: 'Inkopolis Plaza',
  kind: 'lobby',
  sky: { top: '#241a52', bottom: '#ff9d6e', fog: '#ffb28c', fogDensity: 0.0055 },
  bounds: { minX: -TOWN_R, maxX: TOWN_R, minZ: -TOWN_R, maxZ: TOWN_R },
  killY: -20,
  paintable: false,
  parts: townParts,
  spawns: [
    { team: 0, points: [
      { x: -3, y: 0.05, z: 14, yaw: Math.PI },
      { x: 0, y: 0.05, z: 15.5, yaw: Math.PI },
      { x: 3, y: 0.05, z: 14, yaw: Math.PI },
      { x: 6, y: 0.05, z: 15.5, yaw: Math.PI },
    ] },
  ],
  // The doorway that starts matchmaking.
  battleDoor: { x: 0, y: 0, z: -20.4, radius: 4.2 },
  props: [
    { type: 'sign', x: 0, y: 5.6, z: -20.9, rot: 0, text: 'BATTLE' },
    { type: 'shopSign', x: -25, y: 6.2, z: 0.2, rot: -Math.PI / 2, color: '#ff4d9d', text: 'GEAR' },
    { type: 'shopSign', x: 25, y: 5.4, z: 0.2, rot: Math.PI / 2, color: '#5cff9d', text: 'FOOD' },
    { type: 'shopSign', x: -12, y: 5.2, z: 21.6, rot: Math.PI, color: '#ffd23f', text: 'ARCADE' },
    { type: 'shopSign', x: 12, y: 6.6, z: 21.6, rot: Math.PI, color: '#7d5cff', text: 'STUDIO' },
    { type: 'lamp', x: -14, y: 0, z: -12, rot: 0 },
    { type: 'lamp', x: 14, y: 0, z: -12, rot: 0 },
    { type: 'lamp', x: -14, y: 0, z: 12, rot: 0 },
    { type: 'lamp', x: 14, y: 0, z: 12, rot: 0 },
    { type: 'jumbotron', x: 0, y: 12.5, z: -20.6, rot: 0 },
    { type: 'tree', x: -20, y: 0, z: 20, rot: 0.5 },
    { type: 'tree', x: 20, y: 0, z: 20, rot: -0.3 },
    { type: 'tree', x: -20, y: 0, z: -14, rot: 1.2 },
    { type: 'tree', x: 20, y: 0, z: -14, rot: 2.1 },
  ],
};

export const MAPS = { [ARENA.id]: ARENA, [PARK.id]: PARK, [TOWN.id]: TOWN };
export const BATTLE_STAGES = [ARENA, PARK];
export function getMap(id) { return MAPS[id] || ARENA; }
export function randomStage() {
  return BATTLE_STAGES[Math.floor(Math.random() * BATTLE_STAGES.length)];
}
