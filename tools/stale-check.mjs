#!/usr/bin/env node
// M7's first acceptance check: "Killing the server shows the stale banner
// within 6 s, and the screen recovers on its own."
//
//   node tools/stale-check.mjs [--port 3151]
//
// Starts its own server so it can kill one, which is the whole point. The
// recovery has to happen with no reload and no tap: the page sits there and
// comes back by itself.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const PORT = Number(flag('port', '3151'));
const MOCK = flag('mock', 'http://localhost:4001');
const BASE = `http://localhost:${PORT}`;

const env = { ...process.env, PORT: String(PORT), OPENF1_BASE: MOCK, APP_PASSWORD: '', SESSION_KEY: '1001' };
const start = () => spawn(process.execPath, ['apps/server/dist/src/index.js'], { env, stdio: 'ignore' });

const up = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return true;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  throw new Error('server never came up');
};

let failed = false;
const say = (label, ok, detail) => {
  if (!ok) failed = true;
  console.log(`  ${label.padEnd(36)} ${ok ? 'ok  ' : 'FAIL'}  ${detail}`);
};

let srv = start();
await up();

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const page = await (
  await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })
).newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// Wait for cars, not just rows: the point of the screen is that the last
// known positions stay, and there have to be some for that to mean anything.
await page.waitForFunction(
  () => (window.__lapline?.scene?.cars?.size ?? 0) > 0 && document.querySelectorAll('.tower-row').length > 0,
  { timeout: 60_000 },
);
say('the app is running', true, 'cars and tower rows present');

// Kill it, and time how long the banner takes.
const killedAt = Date.now();
srv.kill('SIGKILL');
await page.waitForSelector('.stale-banner', { timeout: 15_000 }).catch(() => {});
const shownAfter = Date.now() - killedAt;
const banner = await page.locator('.stale-banner').count();
say('the banner appears', banner > 0, banner ? `after ${(shownAfter / 1000).toFixed(1)} s` : 'never appeared');
say('within six seconds', banner > 0 && shownAfter <= 6000, `${(shownAfter / 1000).toFixed(1)} s`);

const text = banner ? ((await page.locator('.stale-head').textContent()) ?? '') : '';
say('and says how long it has been quiet', /No new data for \d+ s/.test(text), `"${text}"`);

// The last known positions are still there, which is the point of the screen.
const kept = await page.evaluate(() => ({
  rows: document.querySelectorAll('.tower-row').length,
  cars: window.__lapline?.scene ? [...window.__lapline.scene.cars.keys()].length : 0,
}));
say('last known positions are kept', kept.rows > 0 && kept.cars > 0, `${kept.rows} rows, ${kept.cars} cars`);

// Bring it back, and wait without touching the page.
srv = start();
await up();
const backBy = Date.now() + 30_000;
let recovered = false;
while (Date.now() < backBy) {
  if ((await page.locator('.stale-banner').count()) === 0) {
    recovered = true;
    break;
  }
  await sleep(500);
}
say('recovers on its own, with no tap', recovered, recovered ? 'banner cleared' : 'still showing after 30 s');

// The replacement server opens the session from scratch, so give it the same
// chance the first one had before judging whether data is flowing again.
const alive = await page
  .waitForFunction(() => document.querySelectorAll('.tower-row').length > 0, { timeout: 60_000 })
  .then(() => true)
  .catch(() => false);
say('and is live again', alive, alive ? 'rows are back' : 'no rows after 60 s');

await browser.close();
srv.kill();

if (failed) {
  console.error('\nthe stale path does not behave');
  process.exitCode = 1;
} else {
  console.log('\nthe stale banner appears and clears on its own');
}
