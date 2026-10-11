#!/usr/bin/env node
// Records the SSE stream and reports the numbers the M0 parity checks ask for.
//
//   node tools/parity-check.mjs [--seconds 30] [--rate] [--url http://localhost:3000]
//
// Holds the connection open, because the feed pauses fetching once nobody has
// been connected for a minute. With --rate it also samples /api/state at both
// ends of the window and reports the request rate per minute.

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const SECONDS = Number(flag('seconds', '30'));
const URL_BASE = flag('url', 'http://localhost:3000').replace(/\/$/, '');
const WANT_RATE = has('rate');

const headers = {};
if (process.env.APP_PASSWORD) {
  headers.Authorization = `Basic ${Buffer.from(`any:${process.env.APP_PASSWORD}`).toString('base64')}`;
}

const state = async () => {
  const r = await fetch(`${URL_BASE}/api/state`, { headers });
  if (!r.ok) throw new Error(`/api/state returned ${r.status}`);
  return r.json();
};

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

async function main() {
  const before = await state();
  const t0 = Date.now();

  const res = await fetch(`${URL_BASE}/events`, { headers });
  if (!res.ok) throw new Error(`/events returned ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const ticks = [];
  let init = null;
  let lastTiming = null;
  let statusCount = 0;

  const deadline = t0 + SECONDS * 1000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const p of parts) {
      const m = /^event: (\w+)\ndata: (.*)$/s.exec(p.trim());
      if (!m) continue;
      const data = JSON.parse(m[2]);
      if (m[1] === 'tick') {
        ticks.push({ wall: Date.now(), t: data.t, data });
        if (data.timing) lastTiming = data.timing;
      } else if (m[1] === 'init') init = data;
      else if (m[1] === 'status') statusCount++;
    }
  }
  await reader.cancel().catch(() => {});

  const after = await state();
  const elapsedS = (Date.now() - t0) / 1000;

  if (!ticks.length) {
    console.log(`\nNo ticks in ${fmt(elapsedS, 1)} s. mode=${after.mode} status="${after.status.text}"`);
    process.exitCode = 1;
    return;
  }

  const first = ticks[0];
  const last = ticks.at(-1);
  const wallSpan = (last.wall - first.wall) / 1000;
  const sessSpan = (last.t - first.t) / 1000;
  const withTiming = ticks.filter((x) => x.data.timing).length;
  const cars = last.data.cars;
  const stale = cars.filter((c) => c[10] === 1).length;
  const noSpeed = cars.filter((c) => c[4] === null).length;

  console.log(`\n  session       ${init?.session ? `${init.session.name} (${init.session.key})` : '—'}`);
  console.log(`  mode          ${last.data.mode}`);
  console.log(`  window        ${fmt(elapsedS, 1)} s wall`);
  console.log(`  ticks         ${ticks.length}  (${fmt(ticks.length / wallSpan)}/s, want 4.0)`);
  console.log(`  timing frames ${withTiming}  (${fmt(withTiming / wallSpan)}/s, want 1.0)`);
  console.log(`  clock advance ${fmt(sessSpan / wallSpan)}x  (${fmt(sessSpan, 1)} s of session in ${fmt(wallSpan, 1)} s)`);
  console.log(`  cars          ${cars.length}  (${stale} stale, ${noSpeed} without speed)`);
  if (lastTiming) {
    console.log(`  tower rows    ${lastTiming.rows.length}  leader lap ${lastTiming.lap ?? '—'}  flag ${lastTiming.flag}`);
    console.log(`  race control  ${lastTiming.rc[0]?.msg ?? '—'}`);
  }
  if (last.data.replay) {
    const r = last.data.replay;
    const into = (last.t - r.start) / 1000;
    console.log(`  replay        ${r.playing ? 'playing' : 'paused'} at ${r.speed}x, ${fmt(into, 1)} s into the session`);
  }
  if (last.data.live) {
    console.log(`  live          delay ${last.data.live.delayS} s, mqtt ${last.data.live.mqtt}`);
    console.log(`  clock vs now  ${fmt((Date.now() - last.t) / 1000, 1)} s behind real time`);
  }
  console.log(`  track         ${init?.track ? `${init.track.points.length} points from "${init.track.source}"` : 'none yet'}`);
  console.log(`  status events ${statusCount}`);

  if (WANT_RATE) {
    const used = after.status.api.requests - before.status.api.requests;
    const perMin = (used / elapsedS) * 60;
    console.log(`\n  OpenF1        ${used} requests in ${fmt(elapsedS, 1)} s = ${fmt(perMin, 1)}/min`);
    console.log(`  budget        ${perMin < 50 ? 'under' : 'OVER'} 50/min  (last: ${after.status.api.last})`);
  }
  console.log();
}

main().catch((e) => {
  console.error(`parity-check: ${e.message}`);
  process.exitCode = 1;
});
