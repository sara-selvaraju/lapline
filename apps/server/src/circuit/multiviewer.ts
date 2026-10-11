// The circuit detail file each meeting links to.
//
// OpenF1's `meetings` rows carry a `circuit_info_url` pointing at a JSON file
// hosted by MultiViewer, in the format FastF1 documents as circuit info:
// corners, marshal sectors and lights, a rotation, and a position trace.
//
// Two things to know before changing this:
//
// 1. It is NOT OpenF1, so it must not go through the OpenF1 request queue. That
//    queue exists to spend one rate-limit budget; a third-party host has no
//    part in it, and putting it there would slow OpenF1 requests for nothing.
// 2. It is a third party with no agreement with us, so the parser is tolerant
//    and every caller must cope with getting nothing back. Turns fall back to
//    curvature detection on our own outline.
//
// Verified reachable on 11 October 2026 against the Singapore meeting, whose
// corner coordinates share OpenF1's location frame — same origin, same scale.

import { z } from 'zod';

/** A point in OpenF1's own location frame. */
const TrackPositionSchema = z.object({ x: z.number(), y: z.number() });

/**
 * A corner, marshal sector or marshal light. They share a shape: `number` is
 * the label, `trackPosition` is where it sits, `angle` is the direction to
 * place the label in, and `length` is the distance along the lap.
 */
const MarkerSchema = z.object({
  number: z.number(),
  angle: z.number().optional(),
  length: z.number().optional(),
  trackPosition: TrackPositionSchema,
});
export type CircuitMarker = z.infer<typeof MarkerSchema>;

/**
 * Parses an array, dropping entries that do not fit rather than failing the
 * file. A circuit missing one corner is far more useful than no circuit.
 */
function tolerantArray<T extends z.ZodType>(schema: T) {
  return z.array(z.unknown()).transform((rows) => {
    const out: z.infer<T>[] = [];
    for (const row of rows) {
      const r = schema.safeParse(row);
      if (r.success) out.push(r.data as z.infer<T>);
    }
    return out;
  });
}

export const CircuitInfoSchema = z.object({
  circuitKey: z.number().optional(),
  circuitName: z.string().optional(),
  rotation: z.number().optional(),
  corners: tolerantArray(MarkerSchema).default([]),
  marshalSectors: tolerantArray(MarkerSchema).default([]),
  marshalLights: tolerantArray(MarkerSchema).default([]),
  /** The file's own position trace, as a fallback outline. */
  x: z.array(z.number()).default([]),
  y: z.array(z.number()).default([]),
  /** Time along the lap at each trace point, used to place sector boundaries. */
  trackPositionTime: z.array(z.number()).default([]),
});
export type CircuitInfo = z.infer<typeof CircuitInfoSchema>;

/** How long to wait on a third party before giving up and using the fallback. */
const TIMEOUT_MS = 10_000;

const cache = new Map<string, CircuitInfo | null>();

/** Only for tests; the cache is otherwise per-process and per-meeting. */
export function clearCircuitInfoCache(): void {
  cache.clear();
}

/**
 * Fetches and parses a circuit file, or returns null if anything at all goes
 * wrong. Cached per URL, including the failure: a meeting whose file is missing
 * should not be retried on every session change.
 */
export async function fetchCircuitInfo(
  url: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CircuitInfo | null> {
  if (!url) return null;
  const hit = cache.get(url);
  if (hit !== undefined) return hit;

  let parsed: CircuitInfo | null = null;
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const result = CircuitInfoSchema.safeParse(await res.json());
      if (result.success) parsed = result.data;
      else console.error(`circuit info at ${url} did not parse`);
    } else {
      console.error(`circuit info at ${url}: HTTP ${res.status}`);
    }
  } catch (e) {
    console.error(`circuit info at ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }

  cache.set(url, parsed);
  return parsed;
}
