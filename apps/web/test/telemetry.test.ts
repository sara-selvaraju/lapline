// The phone's reports: the summary arithmetic, when a period is worth sending,
// and the cap on errors sent one by one. What reaches the server is checked
// against the shared schema, so the two sides cannot drift apart.

import { describe, expect, it } from 'vitest';
import { ClientSummarySchema } from '@lapline/shared';
import {
  buildSummary,
  freshCounts,
  MAX_ERROR_REPORTS,
  shouldReportError,
  visibleMsAt,
  worthSending,
} from '../src/stream/telemetry.js';

const meta = { viewer: '0a1b2c3d', ua: 'Mozilla/5.0 (iPhone)', layout: 'portrait' as const };

describe('the summary', () => {
  it('works out frame rate over the visible part of the period only', () => {
    // Visible for the first 30 s of a minute, drawing 1,800 frames: 60 fps,
    // not the 30 a whole-minute average would claim.
    const c = { ...freshCounts(0, true), frames: 1800 };
    c.visibleMs = visibleMsAt(c, 30_000);
    c.visibleSince = null;
    const s = buildSummary(c, 60_000, meta);
    expect(s.fps).toBe(60);
    expect(s.visibleS).toBe(30);
  });

  it('counts time still visible at the moment it is built', () => {
    expect(visibleMsAt(freshCounts(1_000, true), 61_000)).toBe(60_000);
    expect(visibleMsAt(freshCounts(1_000, false), 61_000)).toBe(0);
  });

  it('gives no frame rate for a page that was never seen', () => {
    expect(buildSummary(freshCounts(0, false), 60_000, meta).fps).toBeNull();
  });

  it('is something the server accepts', () => {
    const c = { ...freshCounts(0, true), frames: 3600, reconnects: 2, stalls: 1, contextLost: 1, errors: 3 };
    expect(ClientSummarySchema.safeParse(buildSummary(c, 60_000, meta)).success).toBe(true);
  });

  it('stays inside the schema however long a period runs', () => {
    // A phone that slept for hours and woke: the interval fires late.
    const c = { ...freshCounts(0, true), frames: 10_000_000, errors: 50_000 };
    expect(ClientSummarySchema.safeParse(buildSummary(c, 5 * 3_600_000, meta)).success).toBe(true);
  });
});

describe('whether to send a period', () => {
  it('sends one the page was seen in, or where something went wrong', () => {
    expect(worthSending(buildSummary(freshCounts(0, true), 60_000, meta))).toBe(true);
    expect(worthSending(buildSummary({ ...freshCounts(0, false), reconnects: 1 }, 60_000, meta))).toBe(true);
  });

  it('skips a quiet period in the background', () => {
    expect(worthSending(buildSummary(freshCounts(0, false), 60_000, meta))).toBe(false);
  });
});

describe('errors sent on their own', () => {
  it('sends each message once', () => {
    const sent = new Set<string>();
    expect(shouldReportError(sent, 'a')).toBe(true);
    expect(shouldReportError(sent, 'a')).toBe(false);
  });

  it('stops after the cap, so an error every frame costs a few reports', () => {
    const sent = new Set<string>();
    const results = Array.from({ length: 100 }, (_, i) => shouldReportError(sent, `e${i}`));
    expect(results.filter(Boolean)).toHaveLength(MAX_ERROR_REPORTS);
  });
});
