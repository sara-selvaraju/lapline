#!/usr/bin/env node
// M5's acceptance check: the mock's scripted race control events step through
// every state in replay, with the matching band and layout.
//
//   node tools/state-check.mjs [--url http://localhost:3130] [--shots design/screens]
//
// Drives a replay to each scripted moment and reads what the client actually
// draws: the band's colour class, height and label, and the tower's columns.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const URLBASE = flag('url', 'http://localhost:3130').replace(/\/$/, '');
const SHOTS = flag('shots', null);
const PASSWORD = process.env.APP_PASSWORD;
const headers = PASSWORD ? { Authorization: `Basic ${Buffer.from(`any:${PASSWORD}`).toString('base64')}` } : {};

/** Each scripted moment, and what the band and tower should become. */
const STATES = [
  { name: 'green', at: 60, cls: 'flag-green', label: '', h: 4, last: 'Last lap' },
  { name: 'yellow', at: 140, cls: 'flag-yellow', label: 'Yellow flag', h: 28, last: 'Last lap' },
  { name: 'vsc', at: 430, cls: 'flag-vsc', label: 'Virtual safety car', h: 28, last: 'Pits' },
  { name: 'vsc-ending', at: 470, cls: 'flag-vsc', label: 'Virtual safety car ending', h: 28, last: 'Pits' },
  { name: 'sc', at: 600, cls: 'flag-sc', label: 'Safety car', h: 28, last: 'Pits' },
  { name: 'sc-ending', at: 700, cls: 'flag-sc', label: 'Safety car in this lap', h: 28, last: 'Pits' },
  { name: 'red', at: 860, cls: 'flag-red', label: 'Red flag, session suspended', h: 28, last: null },
  { name: 'chequered', at: null, cls: 'flag-chequered', label: 'Chequered flag', h: 28, last: 'Stops' },
];

const state = await (await fetch(`${URLBASE}/api/state`, { headers })).json();
const start = state.session?.start;
const end = state.session?.end;
if (!start) {
  console.error('no session selected; point --url at a server replaying the mock Sprint');
  process.exit(1);
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
let failed = false;
const say = (label, ok, detail) => {
  if (!ok) failed = true;
  console.log(`  ${label.padEnd(26)} ${ok ? 'ok  ' : 'FAIL'}  ${detail}`);
};

for (const s of STATES) {
  const at = s.at == null ? end + 120_000 : start + s.at * 1000;
  await fetch(`${URLBASE}/api/control`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ at, playing: false }),
  });
  await new Promise((r) => setTimeout(r, 2500));

  // The finished layout only appears once the server has the classification,
  // which it fetches on the first step past the flag. Wait for it rather than
  // guessing how long that takes.
  if (s.at == null) {
    for (let i = 0; i < 30; i++) {
      const now = await (await fetch(`${URLBASE}/api/state`, { headers })).json();
      if (now.result) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ...(PASSWORD ? { httpCredentials: { username: 'any', password: PASSWORD } } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(URLBASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const seen = await page.evaluate(() => {
    const band = document.querySelector('.flag-band');
    const cols = [...document.querySelectorAll('.tower-head > *')].map((e) => e.textContent.trim()).filter(Boolean);
    return {
      cls: band?.className ?? '',
      label: band?.textContent?.trim() ?? '',
      h: band ? Math.round(band.getBoundingClientRect().height) : -1,
      cols,
      scroll: document.documentElement.scrollHeight,
    };
  });

  console.log(`\n${s.name}`);
  say('band colour', seen.cls.includes(s.cls), seen.cls.replace('flag-band ', ''));
  say('band label', seen.label.startsWith(s.label), `"${seen.label}"`);
  say('band height', Math.abs(seen.h - s.h) <= 2, `${seen.h}px, want ${s.h}`);
  if (s.last == null) {
    say('tower drops the lap time', !seen.cols.includes('Last lap'), seen.cols.join(' | '));
    say('tower freezes the gap', seen.cols.includes('Gap at red flag'), seen.cols.join(' | '));
  } else {
    say('tower last column', seen.cols.includes(s.last), seen.cols.join(' | '));
  }
  say('no vertical overflow', seen.scroll <= 846, `${seen.scroll}`);
  say('no page errors', errors.length === 0, errors.join('; ') || 'none');

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/m5-${s.name}.png` });
  await ctx.close();
}

await browser.close();
if (failed) {
  console.error('\nrace states do not all match');
  process.exitCode = 1;
} else {
  console.log('\nevery race state matches its band and layout');
}
