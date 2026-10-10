import { describe, expect, it } from 'vitest';
import { applyReplayControl, clock, newReplayState, replayNow } from '../src/feed/clock.js';

const START = 1_000_000_000_000;
const END = START + 7_200_000;
const bounds = { sessStart: START, sessEnd: END };

describe('replayNow', () => {
  it('advances at the playback speed', () => {
    const r = newReplayState(START, 0);
    expect(replayNow(r, END, 0)).toBe(START);
    expect(replayNow(r, END, 10_000)).toBe(START + 10_000);
    expect(replayNow({ ...r, speed: 8 }, END, 10_000)).toBe(START + 80_000);
  });

  it('holds its anchor while paused', () => {
    const r = { ...newReplayState(START, 0), playing: false, anchorSess: START + 500 };
    expect(replayNow(r, END, 60_000)).toBe(START + 500);
  });

  it('is capped at the session end', () => {
    const r = newReplayState(START, 0);
    expect(replayNow(r, END, 99_999_999)).toBe(END);
  });
});

describe('applyReplayControl', () => {
  it('pausing freezes the clock where it stood', () => {
    const r = newReplayState(START, 0);
    const { replay, seeked } = applyReplayControl(r, { playing: false }, bounds, 10_000);
    expect(replay.playing).toBe(false);
    expect(replay.anchorSess).toBe(START + 10_000);
    expect(seeked).toBe(false);
  });

  it('changing speed keeps the current position', () => {
    const r = newReplayState(START, 0);
    const { replay } = applyReplayControl(r, { speed: 8 }, bounds, 10_000);
    expect(replay.speed).toBe(8);
    expect(replay.anchorSess).toBe(START + 10_000);
    expect(replayNow(replay, END, 11_000)).toBe(START + 10_000 + 8_000);
  });

  it('counts a jump over 5 s as a seek', () => {
    const r = newReplayState(START, 0);
    const { seeked } = applyReplayControl(r, { at: START + 600_000 }, bounds, 10_000);
    expect(seeked).toBe(true);
  });

  it('does not count a jump of 5 s or less as a seek', () => {
    const r = newReplayState(START, 0);
    // The clock stands at START + 10_000, so this is a 4 s nudge.
    const { seeked } = applyReplayControl(r, { at: START + 14_000 }, bounds, 10_000);
    expect(seeked).toBe(false);
  });

  it('clamps a seek to the session, but judges the 5 s test on what was asked', () => {
    const r = newReplayState(START, 0);
    const { replay, seeked } = applyReplayControl(r, { at: START - 999_999 }, bounds, 0);
    expect(replay.anchorSess).toBe(START);
    expect(seeked).toBe(true);
    expect(applyReplayControl(r, { at: END + 999_999 }, bounds, 0).replay.anchorSess).toBe(END);
  });

  it('clamps speed to 0.25 and 32', () => {
    const r = newReplayState(START, 0);
    expect(applyReplayControl(r, { speed: 0.01 }, bounds, 0).replay.speed).toBe(0.25);
    expect(applyReplayControl(r, { speed: 1000 }, bounds, 0).replay.speed).toBe(32);
  });

  it('leaves playing and speed alone when the patch omits them', () => {
    const r = { ...newReplayState(START, 0), playing: false, speed: 4 };
    const { replay } = applyReplayControl(r, { at: START + 60_000 }, bounds, 0);
    expect(replay.playing).toBe(false);
    expect(replay.speed).toBe(4);
  });
});

describe('clock', () => {
  const replay = newReplayState(START, 0);

  it('is now minus the delay when live', () => {
    const t = clock({ mode: 'live', liveDelayMs: 10_000, replay, sessStart: START, sessEnd: END }, 500_000);
    expect(t).toBe(490_000);
  });

  it('follows the replay clock when replaying', () => {
    const t = clock({ mode: 'replay', liveDelayMs: 10_000, replay, sessStart: START, sessEnd: END }, 10_000);
    expect(t).toBe(START + 10_000);
  });

  it('sits at the session start when idle', () => {
    const t = clock({ mode: 'idle', liveDelayMs: 10_000, replay, sessStart: START, sessEnd: END }, 10_000);
    expect(t).toBe(START);
  });

  it('falls back to now when idle with no session', () => {
    const t = clock({ mode: 'idle', liveDelayMs: 10_000, replay, sessStart: undefined, sessEnd: undefined }, 4_242);
    expect(t).toBe(4_242);
  });
});
