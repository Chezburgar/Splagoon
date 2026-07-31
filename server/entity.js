import { PLAYER, INK, WEAPONS } from '../shared/constants.js';
import { FLAG } from '../shared/protocol.js';
import { v3 } from '../shared/world.js';

let nextId = 1;
export function allocId() { return nextId++; }

export function makePlayer(opts = {}) {
  return {
    id: opts.id ?? allocId(),
    name: opts.name || 'Inkling',
    bot: !!opts.bot,
    conn: opts.conn || null,
    team: opts.team ?? 0,
    weapon: opts.weapon || 'shooter',
    gear: opts.gear || 0,

    pos: v3(0, 0, 0),
    vel: v3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    flags: 0,

    hp: PLAYER.maxHealth,
    ink: INK.capacity,
    alive: true,
    respawnAt: 0,
    invulnUntil: 0,

    lastFire: -99,
    charge: 0,
    lastSeen: 0,

    kills: 0,
    deaths: 0,
    turf: 0,
    specialCharge: 0,
    specialActive: 0,     // timestamp the current special ends
    specialKind: WEAPONS[opts.weapon || 'shooter'].special,

    // bot bookkeeping
    ai: null,
  };
}

export function isSquid(p) { return (p.flags & FLAG.SQUID) !== 0; }

export function playerSnapshot(p) {
  return {
    i: p.id,
    p: [round(p.pos.x), round(p.pos.y), round(p.pos.z)],
    v: [round(p.vel.x), round(p.vel.y), round(p.vel.z)],
    y: round(p.yaw),
    q: round(p.pitch),
    f: p.flags,
    h: Math.round(p.hp),
    k: Math.round(p.ink),
    s: Math.round(p.specialCharge),
  };
}

function round(n) { return Math.round(n * 100) / 100; }

export function playerInfo(p) {
  return {
    id: p.id, name: p.name, team: p.team, weapon: p.weapon,
    bot: p.bot, kills: p.kills, deaths: p.deaths, turf: Math.round(p.turf),
  };
}
