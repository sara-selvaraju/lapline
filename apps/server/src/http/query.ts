// The two read-only queries the sync flow and the scrubber need.
//
// Separate endpoints rather than fields on the frame stream: both are asked
// for once, by one screen, and neither belongs in a message sent every second
// to every phone whether or not anything is looking at it.

import type { Feed } from '../feed/feed.js';
import { crossings, lapMetres, nextCrossing } from '../derive/crossings.js';
import { flagPeriods } from '../derive/flags.js';

export function crossingsPayload(feed: Feed, since: number): unknown {
  const t = feed.clock();
  const metres = lapMetres(feed.trackPoints());
  return {
    t,
    lapMetres: metres,
    crossings: crossings(feed.buffersRef(), t, since),
    next: nextCrossing(feed.buffersRef(), t, metres),
  };
}

export function periodsPayload(feed: Feed): unknown {
  return {
    start: feed.sessStart ?? null,
    end: feed.sessEnd ?? null,
    periods: flagPeriods(feed.buffersRef()),
  };
}
