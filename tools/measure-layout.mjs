#!/usr/bin/env node
// Measures the rendered main screen against the portrait layout table in
// docs/DESIGN.md and Main.dc.html, and fails if anything drifts.
//
//   node tools/measure-layout.mjs [--url http://localhost:3000] [--shot path.png]
//
// The acceptance check for M1 is "matches Main.dc.html within a few pixels
// (excluding the 3D view)", so this measures rather than eyeballs.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const URLBASE = flag('url', 'http://localhost:3000').replace(/\/$/, '');
const SHOT = flag('shot', null);
/** Seek here first, in ms from the session start, to reach a scripted state. */
const SEEK = flag('seek', null);
/** The flag band grows to carry a label in any state but green. */
const EXPECT_FLAG = flag('flag', null);
const PASSWORD = process.env.APP_PASSWORD;

/** From Main.dc.html. The track is excluded from the "few pixels" rule but its box is not. */
const EXPECTED = {
  flagBand: 4,
  header: 56,
  track: 290,
  strip: 88,
  towerHead: 30,
  towerRow: 36,
  controls: 68,
};
const TOLERANCE = 2;

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  ...(PASSWORD ? { httpCredentials: { username: 'any', password: PASSWORD } } : {}),
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

if (SEEK) {
  const headers = PASSWORD ? { Authorization: `Basic ${Buffer.from(`any:${PASSWORD}`).toString('base64')}` } : {};
  const state = await (await fetch(`${URLBASE}/api/state`, { headers })).json();
  await fetch(`${URLBASE}/api/control`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ at: state.session.start + Number(SEEK), playing: true }),
  });
  await new Promise((r) => setTimeout(r, 9000));
}

await page.goto(URLBASE, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => document.querySelectorAll('.tower-row').length >= 15, { timeout: 30_000 });
} catch {
  errors.push('tower never filled: no timing frames arrived');
}
await page.waitForTimeout(2500);

const m = await page.evaluate(() => {
  const h = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  };
  const cs = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  };
  const rows = [...document.querySelectorAll('.tower-row')];
  const box = document.querySelector('.tower-rows')?.getBoundingClientRect();
  const whole = box
    ? rows.filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top >= box.top - 1 && b.bottom <= box.bottom + 1;
      }).length
    : 0;
  const any = box
    ? rows.filter((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > box.top && b.top < box.bottom;
      }).length
    : 0;
  const canvas = document.querySelector('.track-canvas');
  const band = document.querySelector('.flag-band');
  return {
    flagClass: band?.className ?? null,
    flagLabel: band?.textContent?.trim() || null,
    flagHeight: band ? Math.round(band.getBoundingClientRect().height) : null,
    heights: {
      flagBand: h('.flag-band'),
      header: h('.header'),
      track: h('.track'),
      strip: h('.strip'),
      towerHead: h('.tower-head'),
      towerRow: h('.tower-row'),
      controls: h('.controls'),
    },
    towerGrid: cs('.tower-head', 'gridTemplateColumns'),
    towerGap: cs('.tower-head', 'columnGap'),
    towerPadding: `${cs('.tower-head', 'paddingLeft')} ${cs('.tower-head', 'paddingRight')}`,
    font: cs('.circuit', 'fontFamily'),
    circuitSize: cs('.circuit', 'fontSize'),
    rowSize: cs('.tower-row', 'fontSize'),
    rowsWhole: whole,
    rowsAny: any,
    rowsTotal: rows.length,
    canvas: canvas ? `${canvas.width}x${canvas.height}` : 'missing',
    docScrollHeight: document.documentElement.scrollHeight,
  };
});

if (SHOT) await page.screenshot({ path: SHOT });
await ctx.close();
await browser.close();

let failed = false;
console.log('\nregion heights, against Main.dc.html');
for (const [k, want] of Object.entries(EXPECTED)) {
  const got = m.heights[k];
  const ok = got != null && Math.abs(got - want) <= TOLERANCE;
  if (!ok) failed = true;
  console.log(`  ${k.padEnd(11)} ${String(got).padStart(4)}  want ${String(want).padStart(4)}  ${ok ? 'ok' : 'DRIFT'}`);
}

console.log('\ntower');
console.log(`  grid        ${m.towerGrid}`);
console.log(`  gap         ${m.towerGap}`);
console.log(`  padding     ${m.towerPadding}`);
console.log(`  rows whole  ${m.rowsWhole}   partly visible ${m.rowsAny}   of ${m.rowsTotal}`);
// "About nine rows show" at 390x844.
const rowsOk = m.rowsAny >= 8 && m.rowsAny <= 10;
if (!rowsOk) failed = true;
console.log(`  about nine  ${rowsOk ? 'ok' : 'DRIFT'}`);

if (EXPECT_FLAG) {
  console.log('\nflag band');
  const wantHeight = EXPECT_FLAG === 'green' ? 4 : 28;
  const classOk = (m.flagClass ?? '').includes(`flag-${EXPECT_FLAG}`);
  const heightOk = Math.abs((m.flagHeight ?? -1) - wantHeight) <= TOLERANCE;
  const labelOk = EXPECT_FLAG === 'green' ? !m.flagLabel : Boolean(m.flagLabel);
  if (!classOk || !heightOk || !labelOk) failed = true;
  console.log(`  class       ${m.flagClass}  ${classOk ? 'ok' : 'DRIFT'}`);
  console.log(`  label       ${m.flagLabel ?? '(none)'}  ${labelOk ? 'ok' : 'DRIFT'}`);
  console.log(`  height      ${m.flagHeight}  want ${wantHeight}  ${heightOk ? 'ok' : 'DRIFT'}`);
}

console.log('\nother');
console.log(`  font        ${m.font}`);
console.log(`  circuit     ${m.circuitSize}  (want 21px)`);
console.log(`  row         ${m.rowSize}  (want 17px)`);
console.log(`  canvas      ${m.canvas}`);
console.log(`  page scroll ${m.docScrollHeight}  (want 844, no vertical overflow)`);
if (m.circuitSize !== '21px' || m.rowSize !== '17px') failed = true;
if (m.docScrollHeight > 846) failed = true;
if (m.canvas === 'missing') failed = true;

console.log(`\nerrors: ${errors.length ? errors.join('; ') : 'none'}`);
if (errors.length) failed = true;

if (failed) {
  console.error('\nlayout does not match the artboard');
  process.exitCode = 1;
} else {
  console.log('\nlayout matches the artboard');
}
