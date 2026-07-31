// Watches one complete match through the browser: queue -> battle -> results
// -> back to the plaza. Run the server with a short match:
//   SPLAGOON_MATCH_SECONDS=45 SPLAGOON_RESULTS_SECONDS=10 npm start
import { chromium } from 'playwright';
const OUT = process.env.SHOT_DIR || '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message + '\n' + e.stack));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION_RESET')) errs.push(m.text()); });
await page.goto(process.env.URL || 'http://localhost:8080/');
await page.waitForTimeout(800);
await page.fill('#nameInput', 'Cycler');
await page.click('#playBtn');
await page.waitForTimeout(3000);
await page.evaluate(() => window.__game.toggleQueue());
const snap = async (label, file) => {
  const s = await page.evaluate(() => {
    const g = window.__game;
    return { room: g.room, phase: g.phase, t: Math.round(g.timeLeft), scores: g.scores,
             cells: g.world ? [...g.world.teamCells] : null, results: !!g.results };
  });
  console.log(label.padEnd(10), JSON.stringify(s));
  if (file) await page.screenshot({ path: `${OUT}/${file}` });
};
await page.waitForTimeout(20000); await snap('start', 'L1-start.png');
await page.waitForTimeout(30000); await snap('midgame', 'L2-mid.png');
await page.waitForTimeout(22000); await snap('results', 'L3-results.png');
await page.waitForTimeout(14000); await snap('back', 'L4-plaza.png');
console.log('\nERRORS:', errs.slice(0, 10).join('\n') || 'none');
await browser.close();
