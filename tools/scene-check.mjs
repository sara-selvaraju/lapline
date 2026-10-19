#!/usr/bin/env node
// The acceptance checks that need a real browser: tapping a bunch opens the
// picker, selection stays in sync between the track and the tower, the frame
// rate with a full field (M2), and the circuit detail layout — no turn badge
// overlapping a car label or the camera group (M3), and a crowded field with
// every car labelled: nothing overlapping, every label beside its own car,
// and the "+n cars" chip opening the picker.
//
//   node tools/scene-check.mjs [--url ...] [--seek ms]

import { chromium } from 'playwright';
import { signIn } from './login.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const URLBASE = flag('url', 'http://localhost:3000').replace(/\/$/, '');
const session = await signIn(URLBASE);
const SEEK = flag('seek', null);
const PASSWORD = process.env.APP_PASSWORD;
const headers = session.headers;

if (SEEK) {
  const st = await (await fetch(`${URLBASE}/api/state`, { headers })).json();
  await fetch(`${URLBASE}/api/control`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ at: st.session.start + Number(SEEK), playing: true }),
  });
  await new Promise((r) => setTimeout(r, 9000));
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
    storageState: { cookies: session.cookies, origins: [] },
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(URLBASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.tower-row').length >= 15, { timeout: 30_000 });
await page.waitForTimeout(3000);

let failed = false;
const say = (label, ok, detail) => {
  if (!ok) failed = true;
  console.log(`  ${label.padEnd(34)} ${ok ? 'ok  ' : 'FAIL'}  ${detail}`);
};

// ---- frame rate with a full field ----
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (times.length < 180) requestAnimationFrame(tick);
        else {
          const sorted = [...times].sort((a, b) => a - b);
          resolve({
            frames: times.length,
            median: sorted[Math.floor(sorted.length / 2)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            worst: sorted.at(-1),
          });
        }
      };
      requestAnimationFrame(tick);
    }),
);
const cars = await page.evaluate(() => document.querySelectorAll('.tower-row').length);
console.log('\nframe timing, headless Chrome at 390x844');
console.log(`  cars in the field                  ${cars}`);
console.log(`  median frame                       ${fps.median.toFixed(1)} ms  (${(1000 / fps.median).toFixed(0)} fps)`);
console.log(`  95th percentile                    ${fps.p95.toFixed(1)} ms`);
console.log(`  worst                              ${fps.worst.toFixed(1)} ms`);
console.log('  NOTE: this is desktop Chrome, not Safari on an iPhone. It shows the');
console.log('  scene is fast enough algorithmically; it does not verify the device target.');

// ---- selection stays in sync ----
console.log('\nselection');
const firstRow = await page.locator('.tower-row').first();
await firstRow.click();
await page.waitForTimeout(400);
const afterTower = await page.evaluate(() => ({
  strip: document.querySelector('.strip-code')?.textContent?.trim(),
  selectedRows: document.querySelectorAll('.tower-row.is-selected').length,
  rowCode: document.querySelector('.tower-row.is-selected .row-code')?.textContent?.trim(),
}));
say('tower tap selects one row', afterTower.selectedRows === 1, `${afterTower.selectedRows} selected`);
say('driver strip follows the tower', afterTower.strip === afterTower.rowCode, `strip ${afterTower.strip}, row ${afterTower.rowCode}`);

const third = page.locator('.tower-row').nth(2);
await third.click();
await page.waitForTimeout(400);
const afterSecond = await page.evaluate(() => ({
  strip: document.querySelector('.strip-code')?.textContent?.trim(),
  rowCode: document.querySelector('.tower-row.is-selected .row-code')?.textContent?.trim(),
}));
say('selection changes with the tower', afterSecond.strip === afterSecond.rowCode && afterSecond.strip !== afterTower.strip,
  `now ${afterSecond.strip}`);

// ---- tapping a bunch opens the picker ----
console.log('\ncar picker');
// Hold the field still. The sweep below takes a few seconds of session time,
// so with the replay running the bunch it finds has driven off by the time it
// reopens the spot. Everything from here on is about a static view.
await fetch(`${URLBASE}/api/control`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ playing: false }),
});
await page.waitForTimeout(500);
const box = await page.locator('.track-canvas').boundingBox();
// Sweep the track for the densest overlap, rather than stopping at the first
// one found: the acceptance check is about a bunch of four, and which spot is
// tightest depends where the field happens to be.
let opened = null;
let bestAt = null;
// The camera group sits over the top-right of the canvas; clicking into it
// would change the view mid-sweep and invalidate everything after.
const overCameraGroup = (fx, fy) => fy < 0.22 && fx > 0.45;
for (let fy = 0.15; fy <= 0.85; fy += 0.04) {
  for (let fx = 0.1; fx <= 0.95; fx += 0.025) {
    if (overCameraGroup(fx, fy)) continue;
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(70);
    const n = await page.evaluate(() => document.querySelectorAll('.picker-row').length);
    if (n > (opened ?? 0)) {
      opened = n;
      bestAt = [fx, fy];
    }
    if (n > 0) await page.evaluate(() => document.querySelector('.picker-scrim')?.click());
    if (opened >= 4) break;
  }
  if (opened >= 4) break;
}
// Reopen the densest spot so the follow-up assertions act on it, and count
// what is actually on screen now rather than trusting the sweep's tally.
let reopened = 0;
if (bestAt) {
  await page.mouse.click(box.x + box.width * bestAt[0], box.y + box.height * bestAt[1]);
  await page.waitForTimeout(150);
  reopened = await page.evaluate(() => document.querySelectorAll('.picker-row').length);
}

say('a bunch opens the picker', opened !== null, opened ? `${opened} cars offered` : 'no bunch found');
if (opened) {
  say('the picker offers four or more', opened >= 4, `${opened} rows`);
  const before = await page.evaluate(() => document.querySelector('.strip-code')?.textContent?.trim());
  if (reopened < 2) {
    say('choosing from it closes the picker', false, `only ${reopened} rows on reopening`);
    say('and selects that car everywhere', false, 'not reached');
    await page.evaluate(() => document.querySelector('.picker-scrim')?.click());
  } else {
  await page.locator('.picker-row').nth(1).click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    strip: document.querySelector('.strip-code')?.textContent?.trim(),
    open: document.querySelectorAll('.picker-row').length,
    rowCode: document.querySelector('.tower-row.is-selected .row-code')?.textContent?.trim(),
  }));
  say('choosing from it closes the picker', after.open === 0, `${after.open} rows left`);
  say('and selects that car everywhere', after.strip === after.rowCode, `strip ${after.strip}, tower ${after.rowCode}, was ${before}`);
  }
}

// ---- circuit detail layout (M3) ----
// Running again: the badges must hold still with the field moving, which is
// the condition the viewer actually sees.
await fetch(`${URLBASE}/api/control`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ playing: true }),
});
// The default view, which is what the acceptance check is about.
await page.getByRole('button', { name: 'Tilt', exact: true }).click();
// Wait for a settled frame rather than sampling blind. The sweep above leaves
// the view mid-change, and measuring then once reported no car labels at all
// on a session that plainly had them.
await page
  .waitForFunction(
    () => {
      const scene = window.__lapline?.scene;
      if (!scene) return false;
      return [...scene.cars.values()].some((c) => c.label.visible);
    },
    { timeout: 10_000 },
  )
  .catch(() => {});
await page.waitForTimeout(2000);

console.log('\ncircuit detail');
const layout = await page.evaluate(() => {
  const scene = window.__lapline?.scene;
  if (!scene) return null;
  const { boxes, obstacles } = scene.layout();
  const rect = (b) => ({
    left: b.x - b.width / 2,
    right: b.x + b.width / 2,
    top: b.y - b.height / 2,
    bottom: b.y + b.height / 2,
  });
  const hits = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

  const badges = boxes.filter((b) => b.kind === 'badge');
  const labels = boxes.filter((b) => b.kind === 'label');
  const overBadge = [];
  const overGroup = [];
  for (const badge of badges) {
    const r = rect(badge);
    for (const label of labels) if (hits(r, rect(label))) overBadge.push(`turn ${badge.key} on ${label.key}`);
    for (const o of obstacles) if (hits(r, o)) overGroup.push(`turn ${badge.key}`);
  }
  return { badges: badges.length, labels: labels.length, obstacles: obstacles.length, overBadge, overGroup };
});

if (!layout) {
  say('scene layout is readable', false, 'window.__lapline.scene missing');
} else {
  // Without a car label on screen there is nothing to check against, so the
  // overlap check below would pass having compared nothing.
  say(
    'turn badges and car labels are drawn',
    layout.badges > 0 && layout.labels > 0,
    `${layout.badges} badges, ${layout.labels} car labels`,
  );
  say(
    'no turn badge overlaps a car label',
    layout.overBadge.length === 0,
    layout.overBadge.length ? layout.overBadge.join(', ') : `checked ${layout.badges} x ${layout.labels}`,
  );
  say(
    'no turn badge overlaps the camera group',
    layout.obstacles > 0 && layout.overGroup.length === 0,
    layout.obstacles === 0
      ? 'no camera group found, so nothing was checked'
      : layout.overGroup.length
        ? layout.overGroup.join(', ')
        : 'clear',
  );
}

// ---- a crowded field ----
// With every car labelled the field cannot all fit, which is where labels
// used to go wrong: the old resolver walked them upwards without limit, and
// in a pack they ended up a column of names 200px from the cars they named.
// Now a label sits beside its own car or not at all, and the cars that did
// not fit share a "+n cars" chip, as SafetyCar.dc.html draws it.
console.log('\ncrowded field, every car labelled');
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByLabel('Label every car').first().click();
await page.getByRole('button', { name: 'Done' }).click();
await fetch(`${URLBASE}/api/control`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ playing: false }),
});
let chipTried = false;
// 'Far' is Tilt with the camera as far back as the controls allow (about
// twice the Tilt distance on a phone), which shrinks the whole
// field into a small patch of screen. Whether the three presets happen to
// show a pack depends on where the race is, which is a property of the data;
// this makes one regardless, so the chip is always exercised.
for (const preset of ['Tilt', 'Map', 'Chase', 'Far']) {
  await page.getByRole('button', { name: preset === 'Far' ? 'Tilt' : preset, exact: true }).click();
  if (preset === 'Far') {
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const scene = window.__lapline?.scene;
      if (!scene) return;
      const to = scene.controls.target;
      scene.camera.position.sub(to).setLength(scene.controls.maxDistance).add(to);
    });
  }
  await page.waitForTimeout(2000);
  const crowd = await page.evaluate(() => {
    const scene = window.__lapline?.scene;
    if (!scene) return null;
    const canvas = document.querySelector('.track-canvas').getBoundingClientRect();
    const { boxes, bunches } = scene.layout();
    const rect = (b) => ({ left: b.x - b.width / 2, right: b.x + b.width / 2, top: b.y - b.height / 2, bottom: b.y + b.height / 2 });
    const hits = (a, b) => a.right - b.left > 1 && b.right - a.left > 1 && a.bottom - b.top > 1 && b.bottom - a.top > 1;
    const shown = boxes.filter((b) => b.kind === 'label' || b.kind === 'chip');
    const overlaps = [];
    for (let i = 0; i < shown.length; i++)
      for (let j = i + 1; j < shown.length; j++)
        if (hits(rect(shown[i]), rect(shown[j]))) overlaps.push(`${shown[i].kind} ${shown[i].key} on ${shown[j].kind} ${shown[j].key}`);
    // How far each label is from the edge of its own dot.
    const right = new scene.camera.position.constructor(1, 0, 0).applyQuaternion(scene.camera.quaternion);
    let worst = 0;
    let worstCar = null;
    for (const b of boxes.filter((x) => x.kind === 'label')) {
      const car = scene.cars.get(b.key);
      const at = (p) => {
        const v = p.clone().project(scene.camera);
        return [((v.x + 1) / 2) * canvas.width, ((1 - v.y) / 2) * canvas.height];
      };
      const [x, y] = at(car.group.position);
      const [ex] = at(car.group.position.clone().addScaledVector(right, car.dot.geometry.parameters.radius));
      const r = Math.abs(ex - x);
      const r2 = rect(b);
      const gap = Math.hypot(Math.max(r2.left - x, 0, x - r2.right), Math.max(r2.top - y, 0, y - r2.bottom)) - r;
      if (gap > worst) {
        worst = gap;
        worstCar = car.code;
      }
    }
    return {
      labels: boxes.filter((b) => b.kind === 'label').length,
      chips: bunches.map((b) => b.cars.length),
      overlaps,
      worst,
      worstCar,
    };
  });
  if (!crowd) {
    say(`${preset}: scene layout is readable`, false, 'window.__lapline.scene missing');
    continue;
  }
  say(
    `${preset}: nothing overlaps`,
    crowd.overlaps.length === 0,
    crowd.overlaps.length ? crowd.overlaps.join(', ') : `${crowd.labels} labels, chips of ${crowd.chips.join(', ') || 'none'}`,
  );
  // The furthest slot is a second row: the gap, a label's height and the gap
  // again, 3 + 19 + 3, with a little for the selected label being taller.
  say(`${preset}: every label beside its own car`, crowd.worst <= 30, `furthest ${crowd.worst.toFixed(0)}px (${crowd.worstCar ?? 'none'})`);

  if (!chipTried && crowd.chips.length) {
    chipTried = true;
    const want = crowd.chips[0];
    await page.locator('.bunch-chip:not([hidden])').first().click();
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => document.querySelectorAll('.picker-row').length);
    say('a "+n cars" chip opens the picker with its cars', rows === want, `chip of ${want}, picker of ${rows}`);
    await page.evaluate(() => document.querySelector('.picker-scrim')?.click());
    await page.waitForTimeout(300);
  }
}
if (!chipTried) say('a "+n cars" chip opens the picker with its cars', false, 'no chip appeared, even with the field pulled into a small space');
await page.getByRole('button', { name: 'Tilt', exact: true }).click();
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByLabel('Label every car').first().click();
await page.getByRole('button', { name: 'Done' }).click();
await fetch(`${URLBASE}/api/control`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ playing: true }),
});

// ---- the scene gives back what it rebuilds (M9) ----
// `setCircuit` runs on every nudge of the elevation slider and every layer
// toggle, not only on a change of circuit. Detaching the old objects is not
// enough: their GPU allocations live until the renderer is torn down, so a
// viewer playing with the slider used to leak a set of track buffers per drag.
// The renderer counts what it holds, so this is measurable rather than a
// matter of opinion.
console.log('\nscene memory across rebuilds');
const mem = await page.evaluate(() => {
  const scene = window.__lapline?.scene;
  if (!scene) return null;
  // Render between rebuilds. `renderer.info.memory` counts what the renderer
  // has registered, and it registers a geometry or texture lazily, on first
  // use — so rebuilding in a tight loop without drawing shows the old ones
  // freed and the new ones not yet counted, which reads as steady whether the
  // old ones were given back or not. Measured: without the disposal this grows
  // by 7 geometries and 10 textures per rebuild.
  const draw = () => {
    scene.setCircuit(scene.circuit, scene.zx);
    scene.renderer.render(scene.scene, scene.camera);
  };
  draw();
  const before = { ...scene.renderer.info.memory, owned: scene.disposables.length };
  for (let i = 0; i < 20; i++) draw();
  return { before, after: { ...scene.renderer.info.memory, owned: scene.disposables.length }, rebuilds: 20 };
});
if (!mem) {
  say('scene memory is readable', false, 'window.__lapline.scene missing');
} else {
  say(
    'geometries steady across 20 rebuilds',
    mem.after.geometries <= mem.before.geometries,
    `${mem.before.geometries} -> ${mem.after.geometries}`,
  );
  say(
    'textures steady across 20 rebuilds',
    mem.after.textures <= mem.before.textures,
    `${mem.before.textures} -> ${mem.after.textures}`,
  );
  say(
    'owned objects steady across 20 rebuilds',
    mem.after.owned <= mem.before.owned,
    `${mem.before.owned} -> ${mem.after.owned}`,
  );
}

// ---- camera presets ----
console.log('\ncamera');
for (const preset of ['Map', 'Chase', 'Tilt']) {
  await page.getByRole('button', { name: preset, exact: true }).click();
  await page.waitForTimeout(300);
  const pressed = await page.evaluate(
    (p) => document.querySelector(`.camera-button[aria-pressed="true"]`)?.textContent?.trim() === p,
    preset,
  );
  say(`${preset} preset selects`, pressed, '');
}

await ctx.close();
await browser.close();
console.log(`\nerrors: ${errors.length ? errors.join('; ') : 'none'}`);
if (errors.length) failed = true;
if (failed) {
  console.error('\nscene checks did not all pass');
  process.exitCode = 1;
} else {
  console.log('\nscene checks pass');
}
