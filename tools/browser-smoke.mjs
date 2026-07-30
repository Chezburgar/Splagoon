// End-to-end browser smoke test: title -> plaza -> matchmaking -> turf war.
// Requires a running server (npm start) and playwright:
//   npm i -D playwright && npx playwright install chromium
//   node tools/browser-smoke.mjs
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const W = Number(process.env.W || 900), H = Number(process.env.H || 560);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('ERR_CONNECTION_RESET')) return; // google fonts, offline sandbox
  if (m.type() === 'error') errors.push(`[console] ${t}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));

const state = () => page.evaluate(() => {
  const g = window.__game;
  return {
    room: g.room, phase: g.phase, team: g.myTeam, queued: g.queued,
    pos: { x: +g.player.pos.x.toFixed(1), y: +g.player.pos.y.toFixed(1), z: +g.player.pos.z.toFixed(1) },
    hp: Math.round(g.player.hp), ink: Math.round(g.player.ink),
    scores: g.scores, remotes: g.remotes.size, roster: g.roster.size,
    cells: g.world ? [...g.world.teamCells] : null, total: g.world?.scoringTotal,
    quality: g.quality, frameMs: Math.round(g.frameAvg),
    particles: g.fx?.particles.length, projectiles: g.fx?.projectiles.length,
    special: Math.round(g.player.specialCharge),
  };
});

await page.goto(process.env.URL || 'http://localhost:8080/');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/01-title.png` });

await page.fill('#nameInput', 'TestSquid');
await page.click('#playBtn');
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/02-plaza.png` });
console.log('PLAZA   ', JSON.stringify(await state()));

// Walk north into Deca Tower to trigger matchmaking (spawn faces the tower).
await page.mouse.click(W / 2, H / 2);
await page.waitForTimeout(200);
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
// Software rendering runs the client in slow motion, so trigger the queue
// directly instead of walking the full distance to the tower door.
await page.evaluate(() => window.__game.toggleQueue());
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/03-tower.png` });
console.log('AT DOOR ', JSON.stringify(await state()));

// Queue timer (12s) + countdown (5s).
await page.waitForTimeout(20000);
await page.screenshot({ path: `${OUT}/04-match-start.png` });
console.log('MATCH   ', JSON.stringify(await state()));

// Fight: shoot, advance, squid-swim back.
await page.mouse.down();
await page.waitForTimeout(3000);
await page.mouse.up();
await page.keyboard.down('KeyW');
await page.mouse.down();
await page.waitForTimeout(4000);
await page.mouse.up();
await page.keyboard.up('KeyW');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-inked.png` });
console.log('INKED   ', JSON.stringify(await state()));

await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyS');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyS');
await page.keyboard.up('ShiftLeft');
await page.screenshot({ path: `${OUT}/06-squid.png` });
console.log('SQUID   ', JSON.stringify(await state()));

// Sub weapon + a wider look around.
await page.mouse.move(W / 2 + 260, H / 2 + 40);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/07-bomb.png` });
console.log('BOMB    ', JSON.stringify(await state()));

const perf = await page.evaluate(() => new Promise((res) => {
  let f = 0; const t0 = performance.now();
  const tick = () => { f++; performance.now() - t0 < 3000 ? requestAnimationFrame(tick) : res(+(f / ((performance.now() - t0) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}));
console.log('SW-RENDER FPS', perf);

console.log('\n=== ERRORS ===');
console.log(errors.slice(0, 25).join('\n') || 'none');
await browser.close();
