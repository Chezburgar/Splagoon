// Shared gameplay constants. Imported by both the authoritative server and the
// browser client, so this file must stay dependency-free.

export const TICK_RATE = 30;                 // server simulation ticks per second
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;             // state broadcasts per second
export const CLIENT_SEND_RATE = 30;          // input/state uploads per second

export const TEAM_ALPHA = 0;
export const TEAM_BRAVO = 1;

// Ink colours. `ink` is what gets painted on the map, `glow` is used for
// emissive trims, HUD accents and the squid-form rim light.
export const TEAMS = [
  { id: TEAM_ALPHA, name: 'Alpha', ink: '#ff5b1f', glow: '#ffa257', css: '#ff5b1f' },
  { id: TEAM_BRAVO, name: 'Bravo', ink: '#12cdf0', glow: '#8ef2ff', css: '#12cdf0' },
];

export const PLAYER = {
  radius: 0.38,
  height: 1.65,
  eyeHeight: 1.45,
  squidRadius: 0.34,
  squidHeight: 0.62,
  maxHealth: 100,
  respawnTime: 3.2,
  invulnAfterSpawn: 1.0,
};

export const MOVE = {
  gravity: 24,
  runSpeed: 5.4,
  swimSpeed: 9.0,          // squid form, own ink
  squidDrySpeed: 3.1,      // squid form, unpainted ground
  enemyInkSpeed: 1.5,      // walking through enemy ink
  jumpSpeed: 7.2,
  squidJumpSpeed: 8.6,
  airControl: 0.62,
  accelGround: 42,
  accelAir: 16,
  friction: 11,
  stepHeight: 0.42,
  climbSpeed: 6.0,         // squid wall-climb
  enemyInkDps: 12,
};

export const INK = {
  capacity: 100,
  refillRate: 46,          // per second while submerged in own ink
  refillRateDry: 0,        // humanoid form does not refill
  enemyInkDrain: 0,
};

// Weapon definitions. `kind` drives the firing routine on the server.
export const WEAPONS = {
  shooter: {
    id: 'shooter',
    name: 'Splattershot',
    kind: 'shooter',
    damage: 32,
    fireInterval: 0.095,
    inkCost: 0.75,
    projectileSpeed: 40,
    projectileGravity: 26,
    projectileLife: 0.62,
    projectileRadius: 0.16,
    spread: 0.038,
    splatRadius: 1.15,
    special: 'inkstrike',
    specialPoints: 180,
    desc: 'All-rounder. Fast fire rate, solid turf coverage.',
    stats: { range: 3, damage: 3, mobility: 4 },
  },
  roller: {
    id: 'roller',
    name: 'Splat Roller',
    kind: 'roller',
    damage: 120,           // flick damage
    fireInterval: 0.62,    // flick cooldown
    inkCost: 5.5,
    rollInkCost: 9.5,      // per second while rolling
    projectileSpeed: 26,
    projectileGravity: 30,
    projectileLife: 0.5,
    projectileRadius: 0.22,
    spread: 0.16,
    pellets: 6,
    splatRadius: 1.5,
    rollSplatRadius: 1.6,
    rollDamage: 130,
    special: 'splashdown',
    specialPoints: 160,
    desc: 'Crush foes and paint wide swathes on the ground.',
    stats: { range: 1, damage: 5, mobility: 3 },
  },
  charger: {
    id: 'charger',
    name: 'Splat Charger',
    kind: 'charger',
    damage: 60,
    fullChargeDamage: 200,
    chargeTime: 1.0,
    fireInterval: 0.35,
    inkCost: 14,
    projectileSpeed: 105,
    projectileGravity: 0.5,
    projectileLife: 0.85,
    projectileRadius: 0.12,
    spread: 0.0,
    splatRadius: 0.85,
    trailSplat: true,
    special: 'bubbler',
    specialPoints: 190,
    desc: 'Charge up to snipe across the whole stage.',
    stats: { range: 5, damage: 5, mobility: 2 },
  },
  slosher: {
    id: 'slosher',
    name: 'Slosher',
    kind: 'slosher',
    damage: 70,
    fireInterval: 0.46,
    inkCost: 7,
    projectileSpeed: 22,
    projectileGravity: 20,
    projectileLife: 1.3,
    projectileRadius: 0.3,
    spread: 0.02,
    pellets: 3,
    splatRadius: 1.7,
    special: 'inkstorm',
    specialPoints: 170,
    desc: 'Lobs heavy ink over cover. Two hits to splat.',
    stats: { range: 2, damage: 4, mobility: 3 },
  },
};

export const WEAPON_ORDER = ['shooter', 'roller', 'charger', 'slosher'];

export const SUB = {
  name: 'Splat Bomb',
  inkCost: 70,
  fuse: 1.35,
  throwSpeed: 15,
  gravity: 24,
  blastRadius: 2.6,
  directDamage: 180,
  splashDamage: 60,
  splatRadius: 3.2,
};

export const SPECIALS = {
  inkstrike: { name: 'Inkstrike', duration: 0.4, radius: 5.5, damage: 150, delay: 1.6 },
  splashdown: { name: 'Splashdown', duration: 0.9, radius: 4.2, damage: 200 },
  bubbler: { name: 'Bubbler', duration: 5.5, radius: 0 },
  inkstorm: { name: 'Ink Storm', duration: 6.0, radius: 6.5, damage: 8 },
};

export const MATCH = {
  duration: 180,
  countdown: 5,
  resultsTime: 14,
  maxPlayersPerTeam: 4,
  minPlayersToStart: 1,   // bots fill the rest
  lobbyQueueSeconds: 12,
};

export const PAINT = {
  gridPerMeter: 2.4,       // gameplay ink lattice resolution
  texelsPerMeter: 22,      // paint render-target resolution
  maxTexSize: 2048,
};

export function teamColor(team) {
  return TEAMS[team] ? TEAMS[team].ink : '#ffffff';
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function randRange(a, b) { return a + Math.random() * (b - a); }
