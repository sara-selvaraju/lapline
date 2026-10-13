#!/usr/bin/env node
// Captures the running app at phone size, for comparison with the artboards.
//
//   node tools/screenshot.mjs [--out design/screens] [--name prototype-parity]
//   [--url http://localhost:3000]
//
// Waits for real data rather than a fixed delay, and reports what it found on
// screen plus any page errors, so a blank or broken render cannot pass as a
// successful screenshot.

import { chromium, devices } from 'playwright';
import { signIn } from './login.mjs';
import { mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const OUT = flag('out', 'design/screens');
const NAME = flag('name', 'prototype-parity');
const URLBASE = flag('url', 'http://localhost:3000').replace(/\/$/, '');
const session = await signIn(URLBASE);
const PASSWORD = process.env.APP_PASSWORD;

const SIZES = [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 844, height: 390 }],
];

await mkdir(OUT, { recursive: true });
// Use the system Chrome rather than a Playwright-managed build, so this needs no
// browser download. Override with PLAYWRIGHT_CHANNEL= to use a bundled one.
const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';
const browser = await chromium.launch(channel ? { channel } : {});
const iphone = devices['iPhone 13'];
let failed = false;

for (const [label, viewport] of SIZES) {
  const ctx = await browser.newContext({
    ...iphone,
    viewport,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: { cookies: session.cookies, origins: [] },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto(URLBASE, { waitUntil: 'domcontentloaded' });
  try {
    // The tower fills from timing frames, so this waits for real data.
    await page.waitForFunction(() => document.querySelectorAll('.tower-row').length >= 15, {
      timeout: 30_000,
    });
  } catch {
    errors.push('tower never filled: no timing frames arrived');
  }
  // Let the scene settle and a few interpolation frames pass.
  await page.waitForTimeout(2500);

  const facts = await page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    const canvas = document.querySelector('.track-canvas');
    return {
      session: text('.circuit'),
      mode: text('.pill-label'),
      lap: text('.lap'),
      flagBand: document.querySelector('.flag-band')?.className ?? null,
      raceControl: text('.race-control'),
      towerRows: document.querySelectorAll('.tower-row').length,
      firstRow: document.querySelector('.tower-row')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      selected: text('.strip-code'),
      speed: text('.strip-speed-value'),
      gear: text('.strip-gear-value'),
      overlayShown: Boolean(document.querySelector('.overlay')),
      canvas: canvas instanceof HTMLCanvasElement ? `${canvas.width}x${canvas.height}` : 'missing',
    };
  });

  const path = `${OUT}/${NAME}-${label}.png`;
  await page.screenshot({ path });
  await ctx.close();

  console.log(`\n${label}  ${viewport.width} x ${viewport.height}  ->  ${path}`);
  for (const [k, v] of Object.entries(facts)) console.log(`  ${k.padEnd(13)} ${v}`);
  if (errors.length) {
    failed = true;
    console.log('  errors:');
    for (const e of errors) console.log(`    ${e}`);
  } else {
    console.log('  errors        none');
  }
  if (facts.towerRows < 15 || facts.canvas === 'missing') failed = true;
}

await browser.close();
if (failed) {
  console.error('\nscreenshot: the page did not render cleanly');
  process.exitCode = 1;
}
