// Practice and qualifying in the tower: which kind of session, and its gaps.

import { describe, expect, it } from 'vitest';
import type { TowerRow } from '@lapline/shared';
import { fastestBest, sessionKind, sessionLabel, timedGap } from '../src/ui/session.js';

const row = (over: Partial<TowerRow>): TowerRow => ({
  n: 1, p: 1, gap: null, int: null, lap: 5, last: null, best: null, outIn: null,
  tyre: null, age: null, pit: false, lapFlag: null, stops: 0, ...over,
});

describe('sessionKind', () => {
  it('reads OpenF1 session names, sprint qualifying included', () => {
    expect(['Race', 'Sprint', 'Qualifying', 'Sprint Qualifying', 'Sprint Shootout', 'Practice 2', undefined].map(sessionKind))
      .toEqual(['race', 'race', 'qualifying', 'qualifying', 'qualifying', 'practice', 'race']);
  });
});

describe('sessionLabel', () => {
  it('names the segment in qualifying and the number in practice', () => {
    expect(sessionLabel('Qualifying', 2)).toEqual({ text: 'Qualifying', bold: 'Q2' });
    expect(sessionLabel('Sprint Qualifying', 1)).toEqual({ text: 'Sprint qualifying', bold: 'SQ1' });
    expect(sessionLabel('Practice 3', null)).toEqual({ text: 'Practice', bold: '3' });
    expect(sessionLabel('Race', null)).toBeNull();
  });
});

describe('timed gaps', () => {
  const rows = [
    row({ n: 1, p: 1, best: 94.471 }),
    row({ n: 2, p: 2, best: 94.539 }),
    row({ n: 3, p: 3, best: null }),
    // Knocked out in Q1 on a time quicker than anyone's in Q2 so far: it is
    // not in the running, so it is not the fastest.
    row({ n: 4, p: 17, best: 94.2, outIn: 1 }),
  ];

  it('measures from the fastest driver still in the running', () => {
    expect(fastestBest(rows)).toBe(94.471);
    expect(rows.map((r) => timedGap(r, 94.471))).toEqual(['Fastest', '+0.068', 'No time', '']);
  });

  it('has no fastest before anyone has a time', () => {
    expect(fastestBest([row({ best: null })])).toBeNull();
    expect(timedGap(row({ best: null }), null)).toBe('No time');
  });
});
