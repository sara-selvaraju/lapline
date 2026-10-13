#!/usr/bin/env node
// M8's acceptance check: "Rotating mid-session keeps the selection, camera and
// stream without a reconnect."
//
//   node tools/rotate-check.mjs [--url http://localhost:3160]
//
// Rotates one live page rather than loading two, which is the only way to tell
// a reflow from a rebuild. tools/screenshot.mjs captures both orientations but
// opens a fresh page for each, so it cannot see this at all.

import { chromium } from 'playwright';
import { signIn } from './login.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const URLBASE = flag('url', 'http://localhost:3160').replace(/\/$/, '');
const session = await signIn(URLBASE);

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

let failed = false;
const say = (label, ok, detail) => {
  if (!ok) failed = true;
  console.log(`  ${label.padEnd(40)} ${ok ? 'ok  ' : 'FAIL'}  ${detail}`);
};

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const ctx = await browser.newContext({
  viewport: PORTRAIT,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  storageState: { cookies: session.cookies, origins: [] },
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(URLBASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__lapline?.scene?.cars?.size ?? 0) > 0, { timeout: 60_000 });

// Count how many EventSources the page ever opens, so a reconnect cannot hide.
await page.evaluate(() => {
  window.__opened = 0;
  const Real = window.EventSource;
  window.EventSource = class extends Real {
    constructor(...a) {
      super(...a);
      window.__opened++;
    }
  };
});

// Choose a car that is not the default, so "kept" means something.
await page.locator('.tower-row').nth(3).click();
await page.waitForTimeout(1200);

const read = async () =>
  page.evaluate(() => {
    const s = window.__lapline?.scene;
    const cam = s?.getCamera?.() ?? null;
    return {
      sceneId: s?.__id ?? null,
      cars: s?.cars?.size ?? 0,
      preset: cam,
      sel: document.querySelector('.tower-row.is-selected .row-code')?.textContent?.trim() ?? null,
      rows: [...document.querySelectorAll('.tower-row')].filter(
        (r) => r.getBoundingClientRect().bottom <= window.innerHeight + 1,
      ).length,
      scroll: document.documentElement.scrollHeight,
      opened: window.__opened,
      lastEvent: window.__lapline?.lastEventAt ?? null,
    };
  });

// Tag the scene so its identity can be compared across the rotation.
await page.evaluate(() => {
  if (window.__lapline?.scene) window.__lapline.scene.__id = 'before';
});

const before = await read();
say('portrait shows the tower', before.rows > 0, `${before.rows} rows on screen`);
say('a car is selected', before.sel != null, `${before.sel}`);

await page.setViewportSize(LANDSCAPE);
await page.waitForTimeout(2500);
const after = await read();

say('the same scene survives', after.sceneId === 'before', after.sceneId ?? 'a new scene was built');
say('the cars are not rebuilt', after.cars === before.cars && after.cars > 0, `${before.cars} then ${after.cars}`);
say('the selection is kept', after.sel === before.sel, `${before.sel} then ${after.sel}`);
say('the camera preset is kept', after.preset === before.preset, `${before.preset} then ${after.preset}`);
say('the stream never reconnected', after.opened === 0, `${after.opened} new connections`);
say('landscape shows the tower', after.rows > 0, `${after.rows} rows on screen`);
say('and does not scroll', after.scroll <= LANDSCAPE.height + 2, `${after.scroll}px`);

// And back again.
await page.setViewportSize(PORTRAIT);
await page.waitForTimeout(2500);
const back = await read();
say('rotating back keeps it all', back.sceneId === 'before' && back.sel === before.sel && back.opened === 0, `${back.sel}, ${back.opened} new connections`);
say('portrait is itself again', back.rows > 0 && back.scroll <= PORTRAIT.height + 2, `${back.rows} rows, ${back.scroll}px`);

say('no page errors', errors.length === 0, errors.join('; ') || 'none');

await browser.close();
if (failed) {
  console.error('\nrotating does not keep the session');
  process.exitCode = 1;
} else {
  console.log('\nrotating keeps the selection, camera and stream');
}
