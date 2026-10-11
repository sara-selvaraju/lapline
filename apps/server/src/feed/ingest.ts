// Turning upstream rows into buffered rows.
//
// Shared by both data paths: REST hands this a page of rows, MQTT hands it one
// row at a time. Rows are deduplicated by driver and timestamp, so an overlapping
// refetch is free. Laps and stints are upserted instead, because OpenF1 updates
// those documents in place as sectors complete.
//
// Nothing is validated beyond the few guards the data demands, which matches the
// prototype. Tolerant zod schemas arrive with protocol v1 in M1.
//
// Ported from reference/prototype/lib/feed.js.

import type {
  CarDataRow,
  DriverRow,
  IngestTopic,
  IntervalRow,
  LapRow,
  LocationRow,
  PitRow,
  PositionRow,
  RaceControlRow,
  StintRow,
  UpstreamRow,
} from '@lapline/shared';
import { bucket, insertSorted, num, type Buffers } from './buffers.js';

/** Date.parse on a missing date gives NaN, exactly as the prototype relies on. */
const ts = (d: string | undefined): number => Date.parse(d as string);

/**
 * Adds rows to the buffers, returning how many landed.
 *
 * `sessionKey` drops rows from a session we are no longer showing; rows with no
 * session_key at all are kept, since not every endpoint carries one.
 */
export function ingest(
  buffers: Buffers,
  sessionKey: number,
  topic: IngestTopic | string,
  rows: readonly unknown[],
): number {
  let added = 0;
  const note = (t: number): void => {
    if (Number.isFinite(t) && (buffers.newest == null || t > buffers.newest)) buffers.newest = t;
  };
  for (const raw of rows) {
    const r = raw as UpstreamRow;
    if (r.session_key !== undefined && r.session_key !== sessionKey) continue;
    const n = r.driver_number as number;
    switch (topic) {
      case 'location': {
        const row = raw as LocationRow;
        // 0,0,0 means the car has no fix, not that it is at the origin.
        if (!row.date || (row.x === 0 && row.y === 0 && row.z === 0)) break;
        const k = `${n}|${row.date}`;
        if (buffers.seen.location.has(k)) break;
        buffers.seen.location.add(k);
        note(ts(row.date));
        insertSorted(bucket(buffers.loc, n), [ts(row.date), row.x as number, row.y as number, row.z as number]);
        added++;
        break;
      }
      case 'car_data': {
        const row = raw as CarDataRow;
        if (!row.date) break;
        const k = `${n}|${row.date}`;
        if (buffers.seen.car_data.has(k)) break;
        buffers.seen.car_data.add(k);
        note(ts(row.date));
        insertSorted(bucket(buffers.car, n), [
          ts(row.date),
          row.speed,
          row.rpm,
          row.n_gear,
          row.throttle,
          row.brake,
          row.drs,
        ]);
        added++;
        break;
      }
      case 'position': {
        const row = raw as PositionRow;
        const k = `${n}|${row.date}`;
        if (buffers.seen.position.has(k)) break;
        buffers.seen.position.add(k);
        note(ts(row.date));
        insertSorted(bucket(buffers.pos, n), [ts(row.date), row.position]);
        added++;
        break;
      }
      case 'intervals': {
        const row = raw as IntervalRow;
        const k = `${n}|${row.date}`;
        if (buffers.seen.intervals.has(k)) break;
        buffers.seen.intervals.add(k);
        note(ts(row.date));
        insertSorted(bucket(buffers.ivl, n), [
          ts(row.date),
          row.gap_to_leader ?? null,
          row.interval ?? null,
        ]);
        added++;
        break;
      }
      case 'race_control': {
        const row = raw as RaceControlRow;
        const k = `${row.date}|${row.message}`;
        if (buffers.seen.race_control.has(k)) break;
        buffers.seen.race_control.add(k);
        note(ts(row.date));
        insertSorted(buffers.rc, [ts(row.date), row]);
        added++;
        break;
      }
      case 'pit': {
        const row = raw as PitRow;
        const k = `${n}|${row.date}`;
        if (buffers.seen.pit.has(k)) break;
        buffers.seen.pit.add(k);
        note(ts(row.date));
        // pit_duration is deprecated; 22 s is a plausible lane time when neither is given.
        insertSorted(bucket(buffers.pits, n), [
          ts(row.date),
          num(row.lane_duration) ?? num(row.pit_duration) ?? 22,
        ]);
        added++;
        break;
      }
      case 'laps': {
        // Laps are updated in place as sectors complete, so upsert by lap number.
        const row = raw as LapRow;
        if (n == null || row.lap_number == null) break;
        let m = buffers.laps.get(n);
        if (!m) buffers.laps.set(n, (m = new Map()));
        const s1 = num(row.duration_sector_1);
        const s2 = num(row.duration_sector_2);
        const s3 = num(row.duration_sector_3);
        m.set(row.lap_number, {
          n: row.lap_number,
          start: row.date_start ? ts(row.date_start) : null,
          dur: num(row.lap_duration),
          pitOut: Boolean(row.is_pit_out_lap),
          sectors: s1 != null && s2 != null && s3 != null ? { s1, s2, s3 } : null,
        });
        added++;
        break;
      }
      case 'stints': {
        const row = raw as StintRow;
        if (n == null || row.stint_number == null) break;
        let m = buffers.stints.get(n);
        if (!m) buffers.stints.set(n, (m = new Map()));
        m.set(row.stint_number, {
          compound: row.compound || null,
          start: row.lap_start ?? 1,
          end: row.lap_end ?? null,
          age0: row.tyre_age_at_start ?? 0,
        });
        added++;
        break;
      }
      case 'drivers': {
        const row = raw as DriverRow;
        if (n == null) break;
        buffers.drivers.set(n, {
          n,
          code: row.name_acronym || String(n),
          name: row.full_name || row.broadcast_name || String(n),
          team: row.team_name || '',
          // The haze token, for a driver upstream has no colour for.
          colour: row.team_colour ? `#${row.team_colour}` : '#9aa4ae',
        });
        added++;
        break;
      }
      default:
        break;
    }
  }
  return added;
}
