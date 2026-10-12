// POST /api/control.
//
// Ported from reference/prototype/server.js. The delay floor was the
// prototype's 3 s against the 4 the design asks for everywhere else; M6
// raised it, because OpenF1's own data arrives about 3 s behind real time and
// a smaller delay is not one anybody can have. Speed is still clamped wider
// than the UI offers, which costs nothing: the cycle sends 1 to 16.

import type { IncomingMessage } from 'node:http';
import type { ControlRequest, ControlResponse } from '@lapline/shared';
import type { Feed } from '../feed/feed.js';
import { MAX_DELAY_S, MIN_DELAY_S } from '../derive/crossings.js';

const BODY_LIMIT = 10_000;

export function readBody(req: IncomingMessage): Promise<ControlRequest> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c;
      if (data.length > BODY_LIMIT) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as ControlRequest) : {});
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    req.on('error', reject);
  });
}

/** Session selection wins over the playback fields, as the prototype orders it. */
export async function control(feed: Feed, body: ControlRequest): Promise<ControlResponse> {
  if (body.session) {
    void feed
      .selectSession(body.session, { manual: true, mode: body.mode })
      .catch((e: unknown) => feed.setStatus('error', e instanceof Error ? e.message : String(e)));
    return { ok: true };
  }

  if (body.follow === 'auto') {
    feed.userPicked = false;
    const s = feed.pickAutoSession();
    if (s) {
      void feed
        .selectSession(s.session_key as number, { manual: false })
        .catch((e: unknown) => feed.setStatus('error', e instanceof Error ? e.message : String(e)));
    }
    return { ok: true };
  }

  if (feed.mode === 'replay') {
    const p: { playing?: boolean; speed?: number; at?: number } = {};
    if (typeof body.playing === 'boolean') p.playing = body.playing;
    if (typeof body.speed === 'number') p.speed = body.speed;
    if (typeof body.at === 'number') p.at = body.at;
    feed.setReplay(p);
  }

  if (feed.mode === 'live' && typeof body.delayS === 'number') {
    feed.liveDelayMs = Math.min(Math.max(body.delayS, MIN_DELAY_S), MAX_DELAY_S) * 1000;
    feed.broadcastStatus();
  }

  return { ok: true };
}
