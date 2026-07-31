// Wire protocol. Plain JSON keeps the client debuggable; messages are kept
// small by using short keys on the hot paths (state snapshots, splats).

export const C2S = {
  HELLO: 'hello',
  INPUT: 'input',
  FIRE: 'fire',
  SUB: 'sub',
  SPECIAL: 'special',
  QUEUE: 'queue',
  UNQUEUE: 'unqueue',
  CHAT: 'chat',
  WEAPON: 'weapon',
  PING: 'ping',
  LEAVE_MATCH: 'leaveMatch',
};

export const S2C = {
  WELCOME: 'welcome',
  ENTER: 'enter',        // entering a room (lobby or match)
  STATE: 'state',
  JOIN: 'join',
  LEAVE: 'leave',
  SPLAT: 'splat',
  PROJ: 'proj',
  HIT: 'hit',
  SPLATTED: 'splatted',
  RESPAWN: 'respawn',
  MATCH: 'match',
  RESULTS: 'results',
  QUEUE: 'queue',
  CHAT: 'chat',
  PONG: 'pong',
  SPECIAL: 'special',
  INK: 'ink',
  FX: 'fx',
};

export const PHASE = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  ACTIVE: 'active',
  ENDED: 'ended',
};

// Player state flag bits used in snapshots.
export const FLAG = {
  SQUID: 1,
  FIRING: 2,
  GROUNDED: 4,
  DEAD: 8,
  CLIMBING: 16,
  SPECIAL: 32,
  MOVING: 64,
};

export function encode(msg) { return JSON.stringify(msg); }
export function decode(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export const round2 = (n) => Math.round(n * 100) / 100;
