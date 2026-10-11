import { describe, expect, it } from 'vitest';
import {
  isDue,
  liveFetchPlan,
  liveWindowFrom,
  MAX_HI_LOOKBACK_MS,
  plannedRequestsPerMinute,
  replayWindow,
  replayWindowMs,
} from '../src/feed/schedule.js';

const START = 1_000_000_000_000;
const END = START + 7_200_000;

describe('replay windows', () => {
  it('is 30 s at 1x and scales with speed', () => {
    expect(replayWindowMs(1)).toBe(30_000);
    expect(replayWindowMs(2)).toBe(40_000);
    expect(replayWindowMs(8)).toBe(160_000);
    expect(replayWindowMs(16)).toBe(320_000);
  });

  it('never drops below 30 s, even below real time', () => {
    expect(replayWindowMs(0.25)).toBe(30_000);
  });

  it('starts 2 s behind the clock on the first fetch', () => {
    const w = replayWindow(undefined, START, 1, END);
    expect(w).toEqual({ from: START - 2000, to: START + 28_000 });
  });

  it('continues from where the last fetch reached', () => {
    const w = replayWindow(START + 10_000, START, 1, END);
    expect(w).toEqual({ from: START + 10_000, to: START + 40_000 });
  });

  it('stops when it is already a full window ahead', () => {
    expect(replayWindow(START + 30_000, START, 1, END)).toBeNull();
    expect(replayWindow(START + 60_000, START, 1, END)).toBeNull();
  });

  it('keeps fetching at 8x, where the window is longer', () => {
    // 160 s of session time per window, so a mark 60 s ahead is still inside it.
    expect(replayWindow(START + 60_000, START, 8, END)).toEqual({
      from: START + 60_000,
      to: START + 220_000,
    });
  });

  it('pulls a stale mark forward to the clock after a backward seek', () => {
    // fetchedUntil far behind the clock: refetch around the new position.
    const w = replayWindow(START - 600_000, START, 1, END);
    expect(w!.from).toBe(START - 2000);
  });

  it('stops at the end of the session', () => {
    expect(replayWindow(END, END - 1000, 1, END)).toBeNull();
    expect(replayWindow(END - 5000, END - 10_000, 1, END)!.to).toBe(END + 1000);
  });
});

describe('the live REST plan', () => {
  it('covers all eight endpoints when MQTT has gone quiet', () => {
    const plan = liveFetchPlan(false);
    expect(plan.map(([ep]) => ep)).toEqual([
      'location',
      'car_data',
      'position',
      'intervals',
      'race_control',
      'pit',
      'laps',
      'stints',
    ]);
  });

  it('polls location and car data every 4 s, which is the bulk of the budget', () => {
    const plan = liveFetchPlan(false);
    expect(plan.find(([ep]) => ep === 'location')![1]).toBe(4000);
    expect(plan.find(([ep]) => ep === 'car_data')![1]).toBe(4000);
  });

  it('drops to a slow repair sweep while MQTT is healthy', () => {
    const plan = liveFetchPlan(true);
    expect(plan.map(([ep]) => ep)).toEqual(['laps', 'stints']);
    expect(plannedRequestsPerMinute(plan)).toBe(1);
  });

  it('demands under 50 requests a minute, the architecture budget', () => {
    // 15 + 15 for the two 4 s endpoints, 4 each for the three at 15 s,
    // 2 each for the three at 30 s = 48. Measured separately against the mock,
    // where queue spacing and the 1 s scheduler tick push the real rate lower.
    const demanded = plannedRequestsPerMinute(liveFetchPlan(false));
    expect(demanded).toBe(48);
    expect(demanded).toBeLessThan(50);
  });

  it('stays inside what the 1.1 s sponsor queue gap can deliver', () => {
    const queueCeiling = 60_000 / 1100;
    expect(plannedRequestsPerMinute(liveFetchPlan(false))).toBeLessThan(queueCeiling);
  });
});

describe('live window starts', () => {
  const NOW = START + 600_000;

  it('reaches back a minute for a high-rate endpoint on the first call', () => {
    expect(liveWindowFrom('hi', undefined, NOW, START)).toBe(NOW - 60_000);
  });

  it('overlaps 10 s on later high-rate calls', () => {
    expect(liveWindowFrom('hi', NOW - 5000, NOW, START)).toBe(NOW - 15_000);
  });

  it('reaches back to the start of the live window for a low-rate endpoint', () => {
    expect(liveWindowFrom('lo', undefined, NOW, START)).toBe(START - 30 * 60_000);
  });

  it('overlaps 30 s on later low-rate calls', () => {
    expect(liveWindowFrom('lo', NOW - 5000, NOW, START)).toBe(NOW - 35_000);
  });

  it('gives no date filter for an endpoint fetched whole', () => {
    expect(liveWindowFrom('all', NOW - 5000, NOW, START)).toBeNull();
  });

  it('never reaches back further than the cap for a high-rate endpoint', () => {
    // A stale mark, as happens after a failed fetch: without the cap this asks
    // for hours of location data, OpenF1 answers 422, the mark stays stale and
    // the next request is bigger still.
    const hoursAgo = NOW - 5 * 3600_000;
    expect(liveWindowFrom('hi', hoursAgo, NOW, START)).toBe(NOW - MAX_HI_LOOKBACK_MS);
  });

  it('still uses the recent mark when it is inside the cap', () => {
    expect(liveWindowFrom('hi', NOW - 5000, NOW, START)).toBe(NOW - 15_000);
  });

  it('leaves the low-rate endpoints uncapped, since they are small', () => {
    // These legitimately fetch the session so far on their first call.
    expect(liveWindowFrom('lo', undefined, NOW, START)).toBe(START - 30 * 60_000);
    const hoursAgo = NOW - 5 * 3600_000;
    expect(liveWindowFrom('lo', hoursAgo, NOW, START)).toBe(hoursAgo - 30_000);
  });
});

describe('isDue', () => {
  it('is due on the first call, since the clock is far past zero', () => {
    expect(isDue(undefined, 4000, START)).toBe(true);
  });

  it('is due once the interval has elapsed', () => {
    expect(isDue(1000, 4000, 4999)).toBe(false);
    expect(isDue(1000, 4000, 5000)).toBe(true);
  });
});
