// Headless checks for the shared simulation: collision, ink lattice, scoring,
// wall climbing and a fast-forwarded bot match.
//   node tools/selftest.mjs

import { World, v3 } from '../shared/world.js';
import { ARENA, TOWN } from '../shared/mapdata.js';
import { PLAYER, MOVE, TICK_DT } from '../shared/constants.js';
import { Match } from '../server/match.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${extra}`); }
};

console.log('\n· world geometry');
const w = new World(ARENA);
check('surfaces built', w.surfaces.length > 50, `(${w.surfaces.length})`);
check('scoring cells', w.scoringTotal > 10000, `(${w.scoringTotal})`);
check('centre island top is y=1.5', Math.abs(w.groundHeightAt(0, 3, 40) - 1.5) < 0.01,
  `got ${w.groundHeightAt(0, 3, 40)}`);
check('centre ramp is a continuous slope', w.groundHeightAt(0, 8, 40) > 0.3 && w.groundHeightAt(0, 8, 40) < 1.2,
  `got ${w.groundHeightAt(0, 8, 40)}`);
check('deck is at y=0', Math.abs(w.groundHeightAt(10, 26, 40)) < 0.01, `got ${w.groundHeightAt(10, 26, 40)}`);
check('spawn platform is at y=3.2', Math.abs(w.groundHeightAt(0, -33, 40) - 3.2) < 0.01);

// Ramps should form a continuous slope up to the platform they serve.
const rampLow = w.groundHeightAt(0, -13.6, 40);
const rampHigh = w.groundHeightAt(0, -15.9, 40);
check('ramp rises toward its platform', rampHigh > rampLow && rampHigh <= 1.21 && rampLow >= 0,
  `low=${rampLow.toFixed(2)} high=${rampHigh.toFixed(2)}`);

console.log('\n· movement');
{
  const pos = v3(10, 12, 26);
  const vel = v3(0, 0, 0);
  const out = {};
  for (let i = 0; i < 120; i++) {
    vel.y -= MOVE.gravity * TICK_DT;
    w.moveCharacter(pos, vel, TICK_DT, PLAYER.radius, PLAYER.height, out);
  }
  check('falls and lands on the deck', out.grounded && Math.abs(pos.y) < 0.01, `y=${pos.y.toFixed(2)}`);

  // Walk into the side of the centre pillar and stop.
  const p2 = v3(0, 1.5, 6);
  const v2 = v3(0, 0, -6);
  for (let i = 0; i < 60; i++) {
    v2.z = -6; v2.y -= MOVE.gravity * TICK_DT;
    w.moveCharacter(p2, v2, TICK_DT, PLAYER.radius, PLAYER.height, out);
  }
  check('blocked by the centre pillar', p2.z > 1.9, `z=${p2.z.toFixed(2)}`);
}

console.log('\n· ink');
{
  const fresh = new World(ARENA);
  const before = fresh.coverage()[0];
  const hits = fresh.splat(v3(10, 0.05, 26), 2, 0);
  check('splat touches a surface', hits.length > 0);
  check('splat paints cells', hits.reduce((a, h) => a + h.changed, 0) > 10);
  check('coverage rises', fresh.coverage()[0] > before);
  check('ink query reports the team', fresh.inkAtGround(10, 0.1, 26) === 0);
  check('unpainted ground reads -1', fresh.inkAtGround(-10, 0.1, 26) === -1);

  fresh.splat(v3(10, 0.05, 26), 2, 1);
  check('enemy ink overwrites', fresh.inkAtGround(10, 0.1, 26) === 1);
  const cov = fresh.coverage();
  check('cells change hands', cov[0] === 0 && cov[1] > 0, JSON.stringify(cov));

  // Ink must not bleed through a wall: paint one side of a tall crate, then
  // check the far side stayed clean.
  const box = ARENA.parts.find((q) => q.type === 'box' && q.style === 'crate' && q.sy >= 3);
  const near = v3(box.x, box.y + 1, box.z - box.sz / 2 - 0.3);
  const far = v3(box.x, box.y + 1, box.z + box.sz / 2 + 0.3);
  const w2 = new World(ARENA);
  w2.splat(near, 1.6, 0);
  const nearSurface = w2.surfaces.find((s) => s.part === box && s.n.z < -0.5);
  const farSurface = w2.surfaces.find((s) => s.part === box && s.n.z > 0.5);
  check('near wall face is inked', w2.inkOnSurfaceAt(nearSurface, near) === 0);
  check('far wall face stays clean', w2.inkOnSurfaceAt(farSurface, far) === -1);

  // Wall climbing needs painted, climbable geometry.
  const climbPos = v3(box.x, box.y + 0.4, box.z - box.sz / 2 - PLAYER.squidRadius - 0.05);
  check('painted wall is climbable', !!w2.climbableWall(climbPos, 0, PLAYER.squidRadius + 0.18));
  check('enemy ink is not climbable', !w2.climbableWall(climbPos, 1, PLAYER.squidRadius + 0.18));
  const w3 = new World(ARENA);
  check('bare wall is not climbable', !w3.climbableWall(climbPos, 0, PLAYER.squidRadius + 0.18));
}

console.log('\n· raycasting');
{
  const hit = w.raycast(v3(10, 6, 26), v3(0, -1, 0), 20);
  check('ray finds the deck', hit && Math.abs(hit.point.y) < 0.01 && hit.normal.y > 0.9);
  check('line of sight is blocked by the pillar', w.losBlocked(v3(0, 3, 6), v3(0, 3, -6)));
  check('open line of sight is clear', !w.losBlocked(v3(-20, 1, 20), v3(-20, 1, 26)));
}

console.log('\n· lobby map');
{
  const town = new World(TOWN);
  check('plaza is not paintable', town.paintable === false);
  check('plaza floor at y=0', Math.abs(town.groundHeightAt(0, 14, 40)) < 0.01);
  const spawn = TOWN.spawns[0].points[0];
  check('spawns stand on the floor', Math.abs(town.groundHeightAt(spawn.x, spawn.z, 40) - spawn.y) < 0.2);
}

console.log('\n· simulated bot match (30s of turf war)');
{
  const match = new Match('test', () => {});
  match.begin([]);
  check('bots filled both teams', match.players.size === 4, `(${match.players.size})`);
  const ticks = Math.round(30 / TICK_DT);
  const t0 = Date.now();
  for (let i = 0; i < ticks; i++) match.update(TICK_DT);
  const ms = Date.now() - t0;
  const cov = match.world.coverage();
  check('bots inked the stage', cov[0] + cov[1] > 0.05, `(${(cov[0] * 100).toFixed(1)}% / ${(cov[1] * 100).toFixed(1)}%)`);
  check('both teams scored', cov[0] > 0.005 && cov[1] > 0.005);
  const anyKill = [...match.players.values()].some((p) => p.kills > 0 || p.deaths > 0);
  check('bots fought each other', anyKill);
  const stuck = [...match.players.values()].filter((p) => p.pos.y < ARENA.killY + 2);
  check('no bot fell out of the world', stuck.length === 0);
  check(`30s of simulation ran in ${ms}ms (budget 30000ms)`, ms < 30000);
}

console.log('\n· full match lifecycle');
{
  let finished = null;
  const m = new Match('life', (mm) => { finished = mm; });
  m.begin([]);
  m.phaseTime = 0.2;                       // shorten the countdown
  let guard = 0;
  while (m.phase !== 'active' && guard++ < 200) m.update(TICK_DT);
  check('countdown reaches the active phase', m.phase === 'active');
  m.phaseTime = 1.5;                       // shorten the match
  guard = 0;
  while (m.phase !== 'ended' && guard++ < 400) m.update(TICK_DT);
  check('match ends on the timer', m.phase === 'ended');
  check('results were computed', !!m.results && m.results.players.length === 4);
  check('winner matches the score', m.results.winner === -1
    || m.results.score[m.results.winner] >= m.results.score[1 - m.results.winner]);
  m.phaseTime = 0.05;
  guard = 0;
  while (!finished && guard++ < 200) m.update(TICK_DT);
  check('room reports itself finished', !!finished && m.closed);
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
