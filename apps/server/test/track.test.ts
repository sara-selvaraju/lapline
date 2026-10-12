import { describe, expect, it } from 'vitest';
import type { SessionRow } from '@lapline/shared';
import {
  pickReferenceLap,
  rankedReferenceLaps,
  smoothZ,
  trackCandidates,
  transformFor,
  usableTrace,
  type LapCandidate,
  type Point,
} from '../src/feed/track.js';

const lap = (o: Partial<Parameters<typeof pickReferenceLap>[0][number]>) => ({
  driver: 4,
  n: 5,
  start: 1000,
  dur: 90,
  pitOut: false,
  ...o,
});

describe('pickReferenceLap', () => {
  it('takes the fastest valid lap', () => {
    expect(pickReferenceLap([lap({ dur: 95 }), lap({ dur: 88, driver: 81 }), lap({ dur: 91 })])!.driver).toBe(81);
  });

  it('skips pit-out laps, the opening lap and laps with no time', () => {
    expect(pickReferenceLap([lap({ dur: 80, pitOut: true })])).toBeNull();
    expect(pickReferenceLap([lap({ n: 1, dur: 80 })])).toBeNull();
    expect(pickReferenceLap([lap({ dur: null })])).toBeNull();
    expect(pickReferenceLap([lap({ start: null })])).toBeNull();
  });

  it('rejects an implausibly short lap, which would be a timing glitch', () => {
    expect(pickReferenceLap([lap({ dur: 40 })])).toBeNull();
    expect(pickReferenceLap([lap({ dur: 41 })])).not.toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickReferenceLap([])).toBeNull();
  });
});

describe('trackCandidates', () => {
  const NOW = 2_000_000_000_000;
  const s = (key: number, meeting: number, endOffset: number): SessionRow => ({
    session_key: key,
    meeting_key: meeting,
    session_name: `S${key}`,
    date_start: new Date(NOW + endOffset - 3_600_000).toISOString(),
    date_end: new Date(NOW + endOffset).toISOString(),
  });

  it('uses only the session itself when replaying', () => {
    const race = s(10, 1, -86_400_000);
    expect(trackCandidates(race, [race, s(9, 1, -90_000_000)], 'replay', NOW).map((x) => x.session_key)).toEqual([10]);
  });

  it('prefers finished sessions of the same meeting when live', () => {
    const race = s(10, 1, 3_600_000);
    // Newest-first, as the session list is ordered.
    const list = [race, s(9, 1, -3_600_000), s(8, 1, -7_200_000), s(7, 2, -3_600_000)];
    const out = trackCandidates(race, list, 'live', NOW).map((x) => x.session_key);
    // Unshifting while walking a newest-first list puts the earliest first.
    expect(out).toEqual([8, 9, 10]);
  });

  it('ignores sessions from another meeting and ones not yet finished', () => {
    const race = s(10, 1, 3_600_000);
    const out = trackCandidates(race, [race, s(7, 2, -3_600_000), s(11, 1, 7_200_000)], 'live', NOW);
    expect(out.map((x) => x.session_key)).toEqual([10]);
  });
});

describe('smoothZ', () => {
  it('averages z over a seven-sample window and leaves x and y alone', () => {
    const raw: Point[] = Array.from({ length: 7 }, (_, i) => [i, i * 2, i === 3 ? 70 : 0]);
    const out = smoothZ(raw);
    expect(out[3]).toEqual([3, 6, 10]);
    expect(out.map((p) => p[0])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('wraps the window, which is right for a closed lap', () => {
    const raw: Point[] = Array.from({ length: 7 }, (_, i) => [i, 0, i === 0 ? 70 : 0]);
    // Index 1 reaches back past 0 to the end of the lap and still sees the spike.
    expect(smoothZ(raw)[1]![2]).toBe(10);
  });

  it('smooths duplicate points by their own index, not the first match', () => {
    const raw: Point[] = [
      [5, 5, 0],
      [5, 5, 0],
      [5, 5, 70],
      [5, 5, 0],
      [5, 5, 0],
      [5, 5, 0],
      [5, 5, 0],
    ];
    // Every sample's window covers the whole loop here, so all land on 10.
    expect(smoothZ(raw).map((p) => p[2])).toEqual([10, 10, 10, 10, 10, 10, 10]);
  });
});

describe('transformFor', () => {
  it('centres on the bounding box and scales the longer axis to 100 units', () => {
    const pts: Point[] = [
      [0, 0, 10],
      [200, 100, 30],
    ];
    expect(transformFor(pts)).toEqual({ cx: 100, cy: 50, cz: 10, scale: 100 / 200 });
  });

  it('takes the floor from the lowest z, so elevation reads from the ground', () => {
    const pts: Point[] = [
      [0, 0, 55],
      [100, 0, 20],
      [50, 50, 80],
    ];
    expect(transformFor(pts).cz).toBe(20);
  });

  it('survives a degenerate trace without dividing by zero', () => {
    expect(transformFor([[5, 5, 5]]).scale).toBe(100);
  });
});

describe('usableTrace', () => {
  /** A circle, which is what a healthy lap looks like to these checks. */
  const circle = (n = 300, r = 5000): Point[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a)), 100] as Point;
    });

  it('accepts a normal lap', () => {
    expect(usableTrace(circle()).ok).toBe(true);
  });

  it('rejects a trace with too few points to be a lap', () => {
    expect(usableTrace(circle(20)).ok).toBe(false);
  });

  it('rejects the Hungary 2026 shape: many rows, few distinct positions', () => {
    // x and y freeze while z counts on, so the rows look plentiful and the
    // positions repeat a couple of dozen values around the whole lap.
    const few = circle(26);
    const frozen: Point[] = [];
    for (let i = 0; i < 312; i++) {
      const p = few[Math.floor(i / 12)]!;
      frozen.push([p[0], p[1], 100 + i]);
    }
    const verdict = usableTrace(frozen);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/distinct/);
  });

  it('rejects a trace that teleports between samples', () => {
    const pts = circle();
    pts[150] = [60_000, 60_000, 100];
    const verdict = usableTrace(pts);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/jump/);
  });

  it('allows the step a tight circuit really produces', () => {
    // Zandvoort is the worst of the 2026 circuits at 6.1% of span; the gate
    // must not be so tight that a real circuit trips it.
    const pts = circle(279, 4858);
    let span = 0;
    for (const [x] of pts) span = Math.max(span, Math.abs(x) * 2);
    pts[100] = [pts[100]![0] + Math.round(span * 0.061), pts[100]![1], 100];
    expect(usableTrace(pts).ok).toBe(true);
  });

  it('rejects a trace with no extent rather than dividing by zero', () => {
    expect(usableTrace(Array.from({ length: 100 }, () => [5, 5, 5] as Point)).ok).toBe(false);
  });
});

describe('rankedReferenceLaps', () => {
  const lap = (n: number, dur: number, driver = 1): LapCandidate => ({
    driver,
    n,
    start: 1000 + n,
    dur,
    pitOut: false,
    sectors: null,
  });

  it('offers several laps, fastest first, so a bad trace is not the end of it', () => {
    const got = rankedReferenceLaps([lap(5, 90), lap(6, 85), lap(7, 88)]);
    expect(got.map((l) => l.n)).toEqual([6, 7, 5]);
  });

  it('still applies the rules about which laps are worth tracing', () => {
    const bad = [
      { ...lap(1, 85), n: 1 },
      { ...lap(5, 30) },
      { ...lap(6, 85), pitOut: true },
    ];
    expect(rankedReferenceLaps(bad)).toEqual([]);
  });

  it('agrees with pickReferenceLap on the first choice', () => {
    const laps = [lap(5, 90), lap(6, 85), lap(7, 88)];
    expect(rankedReferenceLaps(laps)[0]).toEqual(pickReferenceLap(laps));
  });
});
