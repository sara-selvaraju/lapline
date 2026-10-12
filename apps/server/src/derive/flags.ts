// Flags, by replaying race control up to a clock.

import type { MarshalSectorFlag, SectorFlag, TrackFlag } from '@lapline/shared';
import type { Buffers } from '../feed/buffers.js';

/**
 * The track flag at `t`, by replaying race control in order.
 *
 * Sector-scoped flags are ignored: they colour a marshal sector, not the track.
 * Marshal-sector flags and a proper state machine arrive in M3 and M5.
 */
export function trackFlag(buffers: Buffers, t: number): TrackFlag {
  let flag: TrackFlag = 'GREEN';
  for (const [rt, r] of buffers.rc) {
    if (rt > t) break;
    const msg = (r.message || '').toUpperCase();
    if (r.category === 'SafetyCar' || msg.includes('SAFETY CAR')) {
      if (msg.includes('VIRTUAL') && msg.includes('DEPLOYED')) flag = 'VSC';
      else if (msg.includes('DEPLOYED')) flag = 'SC';
      else if (msg.includes('ENDING') || msg.includes('IN THIS LAP')) {
        flag = flag === 'VSC' ? 'VSC ENDING' : 'SC ENDING';
      }
      continue;
    }
    if (r.category === 'Flag' && (r.scope === 'Track' || !r.scope)) {
      const f = (r.flag || '').toUpperCase();
      if (f === 'GREEN' || f === 'CLEAR') flag = 'GREEN';
      else if (f === 'RED') flag = 'RED';
      else if (f === 'CHEQUERED') flag = 'CHEQUERED';
      else if (f.includes('YELLOW')) flag = 'YELLOW';
    }
  }
  return flag;
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
