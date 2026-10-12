// Flags, by replaying race control up to a clock.

import type { MarshalSectorFlag, SectorFlag, TrackFlag } from '@lapline/shared';
import type { Buffers } from '../feed/buffers.js';

/**
 * Whether a safety-car message is about the virtual safety car.
 *
 * OpenF1 writes "VSC DEPLOYED", not "VIRTUAL SAFETY CAR DEPLOYED". Looking
 * only for the spelt-out form is why both of Singapore 2026's VSC periods
 * reported as a full safety car, which is a different thing entirely: a
 * physical car and a bunched field, against delta times and a green track.
 * Both spellings are accepted, since race control uses them interchangeably.
 */
function isVirtual(msg: string): boolean {
  return msg.includes('VSC') || msg.includes('VIRTUAL');
}

/** Whether this is an end-of-period message rather than a deployment. */
function isEnding(msg: string): boolean {
  return msg.includes('ENDING') || msg.includes('IN THIS LAP');
}

/**
 * The track flag at `t`, by replaying race control in order.
 *
 * Sector-scoped flags are ignored: they colour a marshal sector, not the
 * track, and `marshalSectorFlags` reads those instead.
 */
export function trackFlag(buffers: Buffers, t: number): TrackFlag {
  return flagState(buffers, t).flag;
}

export interface FlagState {
  flag: TrackFlag;
  /** When the standing flag began, or null if the track has only been green. */
  since: number | null;
  /** The leader's lap when it began, which the safety car band and the red
   *  flag card both name. Null when no lap is known yet. */
  sinceLap: number | null;
}

/**
 * The standing flag and when it started.
 *
 * The artboards ask for "Safety car since lap 24", "Suspended 12:40" and
 * "Order frozen at the end of lap 31", none of which the flag alone can
 * answer, so the moment the flag last changed is derived here beside it.
 */
export function flagState(buffers: Buffers, t: number): FlagState {
  // Held in an object rather than two locals: the setter below mutates them,
  // and a plain `let` would be narrowed to its initial value at every read.
  const state: { flag: TrackFlag; since: number | null } = { flag: 'GREEN', since: null };

  const set = (next: TrackFlag, at: number): void => {
    if (next === state.flag) return;
    state.flag = next;
    state.since = at;
  };

  for (const [rt, r] of buffers.rc) {
    if (rt > t) break;
    const msg = (r.message || '').toUpperCase();

    if (r.category === 'SafetyCar' || msg.includes('SAFETY CAR') || msg.includes('VSC')) {
      const virtual = isVirtual(msg);
      // An ending message belongs to whatever is running: race control does
      // not always repeat which kind it was, so the message is read in the
      // context of the flag it is ending.
      if (isEnding(msg)) {
        const ending = virtual || state.flag === 'VSC' || state.flag === 'VSC ENDING';
        set(ending ? 'VSC ENDING' : 'SC ENDING', rt);
      } else if (msg.includes('DEPLOYED')) {
        set(virtual ? 'VSC' : 'SC', rt);
      }
      continue;
    }

    if (r.category === 'Flag' && (r.scope === 'Track' || !r.scope)) {
      const f = (r.flag || '').toUpperCase();
      if (f === 'GREEN' || f === 'CLEAR') set('GREEN', rt);
      else if (f === 'RED') set('RED', rt);
      else if (f === 'CHEQUERED') set('CHEQUERED', rt);
      else if (f.includes('YELLOW')) set('YELLOW', rt);
    }
  }

  const { flag, since } = state;
  return { flag, since, sinceLap: since == null ? null : leaderLapAt(buffers, since) };
}

export interface FlagPeriod {
  flag: TrackFlag;
  from: number;
  /** Null while the period is still running at the end of the data. */
  to: number | null;
}

/**
 * Every stretch the track was not green, across the whole session.
 *
 * The replay scrubber marks these, and the timing frames cannot carry them:
 * they hold the standing flag and the last four race control lines, not a
 * history. Rather than a second state machine, this replays the same one and
 * writes down where each state started and stopped.
 *
 * Green is not a period — it is the absence of one — and neither is the
 * chequered flag, which is a moment at the end rather than a stretch to mark.
 */
export function flagPeriods(buffers: Buffers): FlagPeriod[] {
  const out: FlagPeriod[] = [];
  let open: FlagPeriod | null = null;
  let last: TrackFlag = 'GREEN';

  for (const [t] of buffers.rc) {
    const flag = trackFlag(buffers, t);
    if (flag === last) continue;
    last = flag;

    const marks = flag !== 'GREEN' && flag !== 'CHEQUERED';
    // A safety car ending is still a safety car as far as the scrubber is
    // concerned: one stretch of yellow, not two abutting ones.
    const same = open && base(open.flag) === base(flag);
    if (open && !same) {
      open.to = t;
      open = null;
    }
    if (marks && !open) {
      open = { flag, from: t, to: null };
      out.push(open);
    }
  }
  return out;
}

/** SC and SC ENDING are one stretch; so are VSC and VSC ENDING. */
function base(flag: TrackFlag): string {
  return flag.replace(' ENDING', '');
}

/** The highest lap any car had started by `t`, which is the leader's lap. */
function leaderLapAt(buffers: Buffers, t: number): number | null {
  let lap: number | null = null;
  for (const m of buffers.laps.values()) {
    for (const l of m.values()) {
      if (l.start != null && l.start <= t && (lap == null || l.n > lap)) lap = l.n;
    }
  }
  return lap;
}

/**
 * Which marshal sectors are showing a flag at `t`.
 *
 * Race control sends these as a running commentary rather than a state: a
 * YELLOW at a sector, then later a CLEAR at the same sector. Replaying them in
 * order gives the set standing at any moment.
 *
 * Scope is what separates these from the track-wide flag. A driver-scoped blue
 * flag is about one car and a track-scoped red is about everyone; only
 * sector-scoped rows belong to a marshal sector, and Singapore's race carried
 * 18 of them.
 */
export function marshalSectorFlags(buffers: Buffers, t: number): MarshalSectorFlag[] {
  const active = new Map<number, SectorFlag>();
  for (const [rt, r] of buffers.rc) {
    if (rt > t) break;
    if (r.scope !== 'Sector' || r.sector == null) continue;
    const flag = (r.flag || '').toUpperCase();
    if (flag === 'CLEAR' || flag === 'GREEN') active.delete(r.sector);
    else if (flag === 'YELLOW') active.set(r.sector, 'YELLOW');
    else if (flag === 'DOUBLE YELLOW') active.set(r.sector, 'DOUBLE YELLOW');
  }
  return [...active.entries()]
    .map(([sector, flag]) => ({ sector, flag }))
    .sort((a, b) => a.sector - b.sector);
}
