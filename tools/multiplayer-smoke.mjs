// Two browsers in one match: checks presence, chat, team assignment and that
// each client sees the other. Needs a running server and playwright.
//   node tools/multiplayer-smoke.mjs
import { chromium } from 'playwright';
const OUT = process.env.SHOT_DIR || '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const mk = async (name) => {
  const ctx = await browser.newContext({ viewport:{width:700,height:440} });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log(`[${name} pageerror]`, e.message));
  p.on('console', m => { if (m.type()==='error' && !m.text().includes('ERR_CONNECTION')) console.log(`[${name} err]`, m.text()); });
  await p.goto(process.env.URL || 'http://localhost:8080/');
  await p.waitForTimeout(600);
  await p.fill('#nameInput', name);
  await p.click('#playBtn');
  return p;
};
const a = await mk('AlphaOne');
const b = await mk('BravoTwo');
await a.waitForTimeout(3500);
const info = (p) => p.evaluate(() => {
  const g = window.__game;
  return { room: g.room, me: g.myId, team: g.myTeam, roster: [...g.roster.values()].map(x=>`${x.name}:${x.team}`), remotes: g.remotes.size, phase: g.phase };
});
console.log('A lobby', JSON.stringify(await info(a)));
console.log('B lobby', JSON.stringify(await info(b)));
// both queue; chat from A should reach B
await a.evaluate(() => window.__game.net.send({ t:'chat', msg:'hello from A' }));
await a.waitForTimeout(500);
console.log('B sees chat:', await b.evaluate(() => document.getElementById('chatlog').innerText.trim()));
await a.evaluate(() => window.__game.toggleQueue());
await b.waitForTimeout(1000);
await b.evaluate(() => window.__game.toggleQueue());
await a.waitForTimeout(21000);
console.log('A match', JSON.stringify(await info(a)));
console.log('B match', JSON.stringify(await info(b)));
// scoreboard
await a.keyboard.down('Tab');
await a.waitForTimeout(1200);
await a.screenshot({ path: `${OUT}/M1-scoreboard.png` });
await a.keyboard.up('Tab');
// A snapshot mid-battle from each client.
await a.waitForTimeout(6000);
await a.screenshot({ path: `${OUT}/M2-clientA.png` });
await b.screenshot({ path: `${OUT}/M3-clientB.png` });
console.log('A mid ', JSON.stringify(await info(a)));
console.log('(run with SPLAGOON_MATCH_SECONDS=45 to watch the results screen too)');
await browser.close();
