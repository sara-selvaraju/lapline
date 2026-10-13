#!/usr/bin/env node
// The long unattended run, watched from outside (M9).
//
//   node tools/soak.mjs [--minutes 180] [--every 30] [--url http://localhost:3000]
//                       [--pid N] [--out soak.ndjson]
//
// M9's acceptance is a full live session watched on a phone with no manual
// intervention, so what matters is not a snapshot but a curve: resident memory
// and open file descriptors over hours, the OpenF1 request rate against the
// tier's budget, the frame size on the wire, and whether the stream survives
// the chequered flag and the live-to-replay handover.
//
// Everything is sampled from outside the server — /proc for the process,
// /api/state for the feed, and one held-open SSE connection for the frames —
// so nothing in the running code changes to be measured.

import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { signIn } from './login.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const MINUTES = Number(flag('minutes', '180'));
const EVERY_S = Number(flag('every', '30'));
const URL_BASE = flag('url', 'http://localhost:3000').replace(/\/$/, '');
const OUT = flag('out', null);
// Only look for a local server when the URL is a local one. Pointed at
// lapline.live without this, pgrep found whatever server happened to be
// running on this machine and reported its memory as the deployed server's —
// numbers that looked plausible and were about the wrong process.
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/.test(URL_BASE);
const PID = Number(flag('pid', '0')) || (LOCAL ? findServer() : 0);

/** The server process, so /proc can be read without the server reporting on itself. */
function findServer() {
  try {
    const out = execFileSync('pgrep', ['-f', 'apps/server/dist/src/index.js'], { encoding: 'utf8' });
    const pid = Number(out.trim().split('\n')[0]);
    if (pid) return pid;
  } catch {
    /* pgrep finds nothing, or is not here */
  }
  return 0;
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pad = (s, n) => String(s).padEnd(n);

/** Resident set size in MB, and open file descriptors. Linux only, which is Railway. */
async function proc(pid) {
  if (!pid) return { rssMb: null, fds: null };
  let rssMb = null;
  let fds = null;
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const m = /VmRSS:\s+(\d+) kB/.exec(status);
    if (m) rssMb = Number(m[1]) / 1024;
  } catch {
    /* the process has gone */
  }
  try {
    fds = readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    /* ditto */
  }
  return { rssMb, fds };
}

const { headers } = await signIn(URL_BASE);

const state = async () => {
  const r = await fetch(`${URL_BASE}/api/state`, { headers });
  if (!r.ok) throw new Error(`/api/state returned ${r.status}`);
  return r.json();
};

// ---- the held-open stream ----
//
// Counting the raw bytes of each frame, not the parsed object: the frame size
// on the wire is what a phone on mobile data pays for.
const bytes = new Map();
const count = new Map();
let streamErrors = 0;
let reconnects = 0;
let lastTickWall = 0;
let tickGapWorst = 0;
let stop = false;

function note(event, size) {
  bytes.set(event, (bytes.get(event) ?? 0) + size);
  count.set(event, (count.get(event) ?? 0) + 1);
  if (event === 'tick') {
    const now = Date.now();
    if (lastTickWall) tickGapWorst = Math.max(tickGapWorst, now - lastTickWall);
    lastTickWall = now;
  }
}

async function listen() {
  while (!stop) {
    try {
      const res = await fetch(`${URL_BASE}/events`, { headers });
      if (!res.ok) throw new Error(`/events returned ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stop) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const m = /^event: (\w+)\n/.exec(p.trim());
          // The frame as sent: the two newlines the server writes included.
          if (m) note(m[1], Buffer.byteLength(p) + 2);
        }
      }
      await reader.cancel().catch(() => {});
    } catch (e) {
      streamErrors++;
      console.log(`  ! stream: ${e.message}`);
    }
    if (stop) break;
    reconnects++;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ---- the sampling loop ----

const t0 = Date.now();
const samples = [];
// The request count at the start, so the first sample reports a rate rather
// than a zero.
const base = await state().catch(() => null);
let prev = base ? { at: t0, requests: base.status.api.requests, totalBytes: 0, ticks: 0 } : null;
let lastMode = null;
const events = [];

void listen();

console.log(`soak: ${MINUTES} min, sampling every ${EVERY_S} s, server pid ${PID || 'unknown'}`);
if (!PID) {
  console.log(
    LOCAL
      ? '  (no server process found, so memory and file descriptors are not sampled — pass --pid)'
      : `  (${URL_BASE} is not this machine, so memory and file descriptors come from the host's own metrics, not here)`,
  );
}
console.log(
  `\n  ${pad('elapsed', 9)}${pad('mode', 8)}${pad('rss MB', 9)}${pad('fds', 6)}${pad('req/min', 9)}${pad('B/s', 9)}${pad('tick/s', 8)}status`,
);

const deadline = t0 + MINUTES * 60_000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, EVERY_S * 1000));
  let st;
  try {
    st = await state();
  } catch (e) {
    console.log(`  ! /api/state: ${e.message}`);
    events.push({ at: Date.now(), what: `api/state failed: ${e.message}` });
    continue;
  }
  const { rssMb, fds } = await proc(PID);
  const now = Date.now();
  const totalBytes = [...bytes.values()].reduce((a, b) => a + b, 0);
  const ticks = count.get('tick') ?? 0;
  const s = {
    at: now,
    elapsedS: (now - t0) / 1000,
    mode: st.mode,
    status: st.status.text,
    requests: st.status.api.requests,
    freshness: st.status.freshness,
    rssMb,
    fds,
    totalBytes,
    ticks,
    reconnects,
    streamErrors,
  };
  const dt = prev ? (now - prev.at) / 1000 : (now - t0) / 1000;
  const reqMin = prev ? ((s.requests - prev.requests) / dt) * 60 : 0;
  const bps = prev ? (totalBytes - prev.totalBytes) / dt : totalBytes / dt;
  const tps = prev ? (ticks - prev.ticks) / dt : ticks / dt;
  samples.push(s);
  prev = s;
  if (OUT) await appendFile(OUT, `${JSON.stringify(s)}\n`);

  if (lastMode && lastMode !== s.mode) {
    console.log(`  == mode ${lastMode} -> ${s.mode} ==`);
    events.push({ at: now, what: `mode ${lastMode} -> ${s.mode}` });
  }
  lastMode = s.mode;

  console.log(
    `  ${pad(`${fmt(s.elapsedS / 60, 1)}m`, 9)}${pad(s.mode, 8)}${pad(rssMb == null ? '—' : fmt(rssMb), 9)}` +
      `${pad(fds ?? '—', 6)}${pad(fmt(reqMin), 9)}${pad(Math.round(bps), 9)}${pad(fmt(tps), 8)}${s.status.slice(0, 40)}`,
  );
}

stop = true;

// ---- what the run showed ----

console.log('\nframe size on the wire');
const totalSecs = (Date.now() - t0) / 1000;
const order = [...bytes.keys()].sort((a, b) => bytes.get(b) - bytes.get(a));
for (const event of order) {
  const n = count.get(event);
  console.log(
    `  ${pad(event, 10)}${pad(`${n} frames`, 16)}${pad(`${Math.round(bytes.get(event) / n)} B each`, 14)}` +
      `${fmt(bytes.get(event) / totalSecs)} B/s`,
  );
}
const total = [...bytes.values()].reduce((a, b) => a + b, 0);
console.log(`  ${pad('all', 10)}${pad('', 16)}${pad('', 14)}${fmt(total / totalSecs)} B/s` +
  `  (${fmt((total / totalSecs) * 3600 / 1e6, 1)} MB an hour)`);

const withMem = samples.filter((s) => s.rssMb != null);
if (withMem.length >= 2) {
  const first = withMem[0];
  const last = withMem.at(-1);
  const hours = (last.at - first.at) / 3_600_000;
  const slope = hours > 0 ? (last.rssMb - first.rssMb) / hours : 0;
  const peak = Math.max(...withMem.map((s) => s.rssMb));
  console.log('\nmemory and descriptors');
  console.log(`  rss        ${fmt(first.rssMb)} -> ${fmt(last.rssMb)} MB over ${fmt(hours, 2)} h, peak ${fmt(peak)}`);
  // A slope needs a window to have a slope over. Node's heap settles over the
  // first few minutes, so dividing a three-minute rise by three minutes
  // reported 54 MB an hour on a run that was flat — a number worse than none.
  console.log(
    hours >= 0.5
      ? `  slope      ${fmt(slope)} MB/hour`
      : `  slope      —  (${fmt(hours * 60)} min is too short a window to read a slope from)`,
  );
  console.log(`  fds        ${first.fds} -> ${last.fds}`);
}

const reqs = samples.filter((s) => Number.isFinite(s.requests));
if (reqs.length >= 2) {
  const used = reqs.at(-1).requests - reqs[0].requests;
  const mins = (reqs.at(-1).at - reqs[0].at) / 60_000;
  console.log('\nOpenF1');
  console.log(`  requests   ${used} in ${fmt(mins)} min = ${fmt(used / mins)}/min`);
}

console.log('\nstream');
console.log(`  reconnects ${reconnects}, errors ${streamErrors}`);
console.log(`  worst gap between ticks ${fmt(tickGapWorst / 1000, 1)} s`);
console.log(`  mode changes: ${events.length ? events.map((e) => e.what).join(', ') : 'none'}`);
console.log();
