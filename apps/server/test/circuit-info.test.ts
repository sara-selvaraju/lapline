// The circuit file parser and its fallback.
//
// Everything here assumes a third party that may be slow, missing, or sending
// something unexpected, because that is exactly what it is.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitInfoSchema, clearCircuitInfoCache, fetchCircuitInfo } from '../src/circuit/multiviewer.js';
import { curvature, turnsFromCurvature, type Point2 } from '../src/circuit/curvature.js';

const marker = (number: number, x: number, y: number) => ({
  number,
  angle: 40,
  length: 100,
  trackPosition: { x, y },
});

const file = {
  circuitKey: 61,
  circuitName: 'Singapore',
  rotation: 335,
  corners: [marker(1, 431, 3476), marker(2, -200, 1000)],
  marshalSectors: [marker(1, 1116, -684)],
  marshalLights: [marker(1, 1116, -684)],
  x: [0, 1, 2],
  y: [0, 1, 2],
  trackPositionTime: [0, 1, 2],
};

afterEach(() => {
  clearCircuitInfoCache();
  vi.restoreAllMocks();
});

describe('the circuit file schema', () => {
  it('parses a well-formed file', () => {
    const r = CircuitInfoSchema.safeParse(file);
    expect(r.success).toBe(true);
    expect(r.success && r.data.corners).toHaveLength(2);
  });

  it('drops a bad corner rather than failing the file', () => {
    // One corner missing its position; a circuit short one corner beats none.
    const r = CircuitInfoSchema.safeParse({ ...file, corners: [marker(1, 1, 2), { number: 2 }, marker(3, 3, 4)] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.corners.map((c) => c.number)).toEqual([1, 3]);
  });

  it('copes with arrays missing entirely', () => {
    const r = CircuitInfoSchema.safeParse({ circuitName: 'Nowhere' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.corners).toEqual([]);
    expect(r.success && r.data.marshalSectors).toEqual([]);
  });

  it('tolerates extra fields it does not know about', () => {
    expect(CircuitInfoSchema.safeParse({ ...file, somethingNew: { a: 1 } }).success).toBe(true);
  });

  it('accepts a corner without the optional angle and length', () => {
    const r = CircuitInfoSchema.safeParse({ ...file, corners: [{ number: 1, trackPosition: { x: 1, y: 2 } }] });
    expect(r.success && r.data.corners).toHaveLength(1);
  });

  it('rejects a position that is not numbers', () => {
    const r = CircuitInfoSchema.safeParse({ ...file, corners: [{ number: 1, trackPosition: { x: 'a', y: 2 } }] });
    expect(r.success && r.data.corners).toEqual([]);
  });
});

describe('fetchCircuitInfo', () => {
  const url = 'https://example.test/circuits/61/2026';

  it('returns null without a url, and makes no request', async () => {
    const f = vi.fn();
    expect(await fetchCircuitInfo(undefined, f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('fetches and parses', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(file), { status: 200 }));
    const out = await fetchCircuitInfo(url, f as unknown as typeof fetch);
    expect(out?.corners).toHaveLength(2);
  });

  it('caches, so a session change does not refetch', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(file), { status: 200 }));
    await fetchCircuitInfo(url, f as unknown as typeof fetch);
    await fetchCircuitInfo(url, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns null on an error status, and caches that too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => new Response('nope', { status: 404 }));
    expect(await fetchCircuitInfo(url, f as unknown as typeof fetch)).toBeNull();
    // A meeting with no file must not be retried on every session change.
    await fetchCircuitInfo(url, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns null when the host is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await fetchCircuitInfo(url, f as unknown as typeof fetch)).toBeNull();
  });

  it('returns null when the body is not JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => new Response('<html>down for maintenance</html>', { status: 200 }));
    expect(await fetchCircuitInfo(url, f as unknown as typeof fetch)).toBeNull();
  });

  it('returns null when the JSON is the wrong shape entirely', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn(async () => new Response(JSON.stringify([1, 2, 3]), { status: 200 }));
    expect(await fetchCircuitInfo(url, f as unknown as typeof fetch)).toBeNull();
  });
});

describe('turns from curvature', () => {
  /** A rounded rectangle: four obvious corners, straights between them. */
  const roundedRect = (): Point2[] => {
    const pts: Point2[] = [];
    const w = 100;
    const h = 60;
    const r = 12;
    const step = 2;
    const arc = (cx: number, cy: number, from: number) => {
      for (let a = 0; a <= 90; a += 6) {
        const t = ((from + a) * Math.PI) / 180;
        pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
      }
    };
    for (let x = -w + r; x <= w - r; x += step) pts.push({ x, y: -h });
    arc(w - r, -h + r, -90);
    for (let y = -h + r; y <= h - r; y += step) pts.push({ x: w, y });
    arc(w - r, h - r, 0);
    for (let x = w - r; x >= -w + r; x -= step) pts.push({ x, y: h });
    arc(-w + r, h - r, 90);
    for (let y = h - r; y >= -h + r; y -= step) pts.push({ x: -w, y });
    arc(-w + r, -h + r, 180);
    return pts;
  };

  it('finds the four corners of a rounded rectangle', () => {
    const turns = turnsFromCurvature(roundedRect());
    expect(turns).toHaveLength(4);
  });

  it('numbers them in the order they come after the line', () => {
    expect(turnsFromCurvature(roundedRect()).map((t) => t.number)).toEqual([1, 2, 3, 4]);
  });

  it('finds no corners on a circle, which turns evenly throughout', () => {
    const circle: Point2[] = Array.from({ length: 200 }, (_, i) => {
      const t = (i / 200) * Math.PI * 2;
      return { x: Math.cos(t) * 100, y: Math.sin(t) * 100 };
    });
    // Nothing stands out from a shape that curves the same everywhere.
    expect(turnsFromCurvature(circle)).toEqual([]);
  });

  it('is indifferent to the units the coordinates use', () => {
    // Curvature is 1/radius, so an absolute threshold is a threshold in
    // whatever units the trace happens to use, and OpenF1's vary by circuit.
    const shape = (scale: number): Point2[] =>
      Array.from({ length: 240 }, (_, i) => {
        const t = (i / 240) * Math.PI * 2;
        const r = 1 + 0.35 * Math.sin(3 * t);
        return { x: Math.cos(t) * r * scale, y: Math.sin(t) * r * scale };
      });
    const small = turnsFromCurvature(shape(10));
    const large = turnsFromCurvature(shape(10_000));
    expect(small.length).toBeGreaterThan(0);
    expect(large.length).toBe(small.length);
  });

  it('returns nothing for a trace too short to judge', () => {
    expect(turnsFromCurvature([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
    expect(curvature([{ x: 0, y: 0 }])).toEqual([0]);
  });
});
