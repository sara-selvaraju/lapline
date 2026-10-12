#!/usr/bin/env node
// Runs the circuit pipeline against real sessions at several circuits, to see
// whether what was calibrated at one track holds at the others.
//
//   node tools/circuit-check.mjs [--circuits Austin,Monza] [--year 2026]
//
// Everything here calls the shipped modules, not a copy of them, so a pass is
// evidence about the product. Reports per circuit: the outline, how well the
// circuit file's corners land on it, what the curvature fallback would find
// instead, the sector boundaries, and whether a pit lane could be derived.

import { setTimeout as sleep } from 'node:timers/promises';
import { rankedReferenceLaps, smoothZ, transformFor, usableTrace } from '../apps/server/dist/src/feed/track.js';
import { resolveMarkers, turnsFromOutline, sectorBoundaries } from '../apps/server/dist/src/circuit/resolve.js';
import { pitLaneFromTrace, pickPitStops, stopWindow, offsetFromOutline } from '../apps/server/dist/src/circuit/pitlane.js';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const YEAR = Number(flag('year', 2026));
const ONLY = flag('circuits', null)?.split(',').map((s) => s.trim().toLowerCase());

// Free tier: 3 a second and 30 a minute. Stay well inside it.
const GAP_MS = 2200;
let last = 0;
async function api(path) {
  const wait = GAP_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(`https://api.openf1.org/v1/${path}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const iso = (ms) => new Date(ms).toISOString().replace('+00:00', 'Z');
const clean = (rows) => rows.filter((r) => !(r.x === 0 && r.y === 0 && r.z === 0));

async function check(session) {
  const key = session.session_key;
  const name = session.circuit_short_name || session.location;
  const out = { name, year: session.year, key, notes: [] };

  // --- outline, exactly as the feed builds it ---
  const laps = (await api(`laps?session_key=${key}`)).map((r) => ({
    driver: r.driver_number,
    n: r.lap_number,
    start: r.date_start ? Date.parse(r.date_start) : null,
    dur: r.lap_duration,
    pitOut: Boolean(r.is_pit_out_lap),
    sectors:
      r.duration_sector_1 != null && r.duration_sector_2 != null && r.duration_sector_3 != null
        ? { s1: r.duration_sector_1, s2: r.duration_sector_2, s3: r.duration_sector_3 }
        : null,
  }));
  // Same walk the feed does: fastest first, skipping laps whose positions
  // are not good enough to draw from.
  const candidates = rankedReferenceLaps(laps);
  if (candidates.length === 0) return { ...out, fail: 'no reference lap' };
  let ref = null;
  let points = null;
  const rejected = [];
  for (const lap of candidates) {
    const trace = clean(
      await api(
        `location?session_key=${key}&driver_number=${lap.driver}` +
          `&date%3E=${encodeURIComponent(iso(lap.start - 500))}` +
          `&date%3C${encodeURIComponent(iso(lap.start + lap.dur * 1000 + 500))}`,
      ),
    );
    const pts = smoothZ(trace.map((r) => [r.x, r.y, r.z]));
    const verdict = usableTrace(pts);
    if (verdict.ok) {
      ref = lap;
      points = pts;
      break;
    }
    rejected.push(`lap ${lap.n}: ${verdict.reason}`);
  }
  if (!points) return { ...out, fail: `no usable trace (${rejected.join('; ')})` };
  if (rejected.length) out.notes.push(`skipped ${rejected.length} unusable lap(s): ${rejected[0]}`);
  const t = transformFor(points);
  out.points = points.length;
  out.span = Math.round(100 / t.scale);
  out.lap = ref.dur;

  // Trace quality, for calibrating what a usable lap looks like.
  const distinct = new Set(points.map((p) => `${p[0]},${p[1]}`)).size;
  out.distinctPct = Math.round((distinct / points.length) * 100);
  let maxStep = 0;
  for (let i = 1; i < points.length; i++) {
    maxStep = Math.max(maxStep, Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  out.maxStepPct = ((maxStep / out.span) * 100).toFixed(1);

  // --- corners from the circuit file ---
  const meetings = await api(`meetings?meeting_key=${session.meeting_key}`);
  const url = meetings[0]?.circuit_info_url;
  out.hasFile = Boolean(url);
  if (url) {
    const res = await fetch(url);
    if (res.ok) {
      const file = await res.json();
      const corners = (file.corners ?? []).map((c) => ({ number: c.number, trackPosition: c.trackPosition }));
      const marshals = (file.marshalSectors ?? []).map((c) => ({ number: c.number, trackPosition: c.trackPosition }));
      out.fileCorners = corners.length;
      const resolved = resolveMarkers(points, corners);
      out.turns = resolved.length;
      out.marshals = resolveMarkers(points, marshals).length;
      // How far each corner lands from where the file says it is.
      const errs = resolved
        .map((m) => {
          const c = corners.find((x) => x.number === m.number);
          const p = points[m.index];
          return c ? Math.hypot(c.trackPosition.x - p[0], c.trackPosition.y - p[1]) : null;
        })
        .filter((d) => d != null)
        .sort((a, b) => a - b);
      out.cornerErrMedian = Math.round(errs[Math.floor(errs.length / 2)]);
      out.cornerErrWorst = Math.round(errs[errs.length - 1]);
      out.cornerErrPct = ((errs[errs.length - 1] / out.span) * 100).toFixed(2);
      // Numbered 1..n in lap order?
      const nums = resolved.map((m) => m.number);
      out.inLapOrder = nums.every((v, i) => i === 0 || v >= nums[i - 1]) || nums.every((v, i) => i === 0 || v <= nums[i - 1]);
      const idx = resolved.map((m) => m.index);
      out.distinctIndices = new Set(idx).size === idx.length;
    } else {
      out.notes.push(`circuit file ${res.status}`);
    }
  }
  // What the fallback would find on its own.
  out.curvatureTurns = turnsFromOutline(points).length;

  // --- sector boundaries ---
  out.sectors = sectorBoundaries(points.length, ref.sectors).map((s) => s.index);

  // --- pit lane ---
  const pits = (await api(`pit?session_key=${key}`))
    .filter((p) => p.lane_duration)
    .map((p) => ({ driver: p.driver_number, at: Date.parse(p.date), laneDurationS: p.lane_duration }));
  out.pitStops = pits.length;
  const stops = pickPitStops(pits);
  if (stops.length) {
    const stop = stops[0];
    const w = stopWindow(stop);
    const rows = clean(
      await api(
        `location?session_key=${key}&driver_number=${stop.driver}` +
          `&date%3E=${encodeURIComponent(iso(w.from))}&date%3C${encodeURIComponent(iso(w.to))}`,
      ),
    ).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const lane = pitLaneFromTrace(points, rows.map((r) => [r.x, r.y, r.z]));
    out.pitLane = lane.length;
    if (lane.length) {
      let len = 0;
      for (let i = 1; i < lane.length; i++) len += Math.hypot(lane[i][0] - lane[i - 1][0], lane[i][1] - lane[i - 1][1]);
      out.pitLanePct = ((len / out.span) * 100).toFixed(0);
      const offs = lane.map((p) => offsetFromOutline(points, p)).sort((a, b) => a - b);
      out.pitOffsetMedian = Math.round(offs[Math.floor(offs.length / 2)]);
    }
    // A clean racing lap must yield nothing, or the threshold is too low here.
    const other = laps.find((l) => l.driver === stop.driver && l.dur && !l.pitOut && l.n > 2 && Math.abs(l.start - stop.at) > 300_000);
    if (other) {
      const rows2 = clean(
        await api(
          `location?session_key=${key}&driver_number=${other.driver}` +
            `&date%3E=${encodeURIComponent(iso(other.start))}&date%3C${encodeURIComponent(iso(other.start + other.dur * 1000))}`,
        ),
      ).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      out.falsePositive = pitLaneFromTrace(points, rows2.map((r) => [r.x, r.y, r.z])).length;
    }
  }
  return out;
}

const sessions = (await api(`sessions?session_type=Race&year=${YEAR}`)).filter((s) => !s.is_cancelled);
const wanted = ONLY
  ? sessions.filter((s) => ONLY.some((c) => (s.circuit_short_name || s.location || '').toLowerCase().includes(c)))
  : sessions;
// One race per circuit, the last one run.
const byCircuit = new Map();
for (const s of wanted) if (Date.parse(s.date_end) < Date.now()) byCircuit.set(s.circuit_short_name, s);

console.log(`Checking ${byCircuit.size} circuits from ${YEAR}\n`);
const results = [];
for (const s of byCircuit.values()) {
  try {
    const r = await check(s);
    results.push(r);
    if (r.fail) {
      console.log(`${r.name.padEnd(20)} COULD NOT CHECK: ${r.fail}`);
      continue;
    }
    console.log(
      `${r.name.padEnd(20)} outline ${String(r.points).padStart(4)} pts, span ${String(r.span).padStart(6)}, lap ${r.lap}s` +
        ` | distinct ${String(r.distinctPct).padStart(3)}%, biggest step ${String(r.maxStepPct).padStart(5)}% of span`,
    );
    console.log(
      `${''.padEnd(20)} turns ${String(r.turns ?? 0).padStart(2)}/${String(r.fileCorners ?? 0).padStart(2)} from file` +
        ` (worst ${r.cornerErrWorst ?? '-'} = ${r.cornerErrPct ?? '-'}% of span,` +
        ` lap order ${r.inLapOrder ? 'yes' : 'NO'}, distinct ${r.distinctIndices ? 'yes' : 'NO'})` +
        ` | curvature alone would find ${r.curvatureTurns}`,
    );
    console.log(
      `${''.padEnd(20)} marshals ${String(r.marshals ?? 0).padStart(2)} | sectors at ${r.sectors.join('/')}` +
        ` | ${r.pitStops} pit stops -> lane ${r.pitLane ?? 0} pts` +
        (r.pitLane ? ` (${r.pitLanePct}% of span, ${r.pitOffsetMedian} units off line)` : '') +
        (r.falsePositive != null ? ` | clean lap yields ${r.falsePositive}` : ''),
    );
    for (const n of r.notes) console.log(`${''.padEnd(20)} note: ${n}`);
    console.log();
  } catch (e) {
    console.log(`${(s.circuit_short_name || '?').padEnd(20)} ERROR ${e.message}\n`);
    results.push({ name: s.circuit_short_name, fail: e.message });
  }
}
