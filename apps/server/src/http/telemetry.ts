// POST /api/telemetry: phones report errors and a once-a-minute summary, and
// each report becomes a line in the server log.
//
// Behind the password like every other route. A browser can send anything, so
// a body is capped before it is read, validated against the shared schema,
// and rate limited per address and in total. The address is used for the
// limit only and never logged; a phone is told apart by a random id it makes
// per page load.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ClientReportSchema, TELEMETRY_BODY_LIMIT, type ClientReport } from '@lapline/shared';
import { log } from '../log.js';

/** One phone sends a summary a minute and a handful of errors at most. */
export const PER_ADDRESS_PER_MIN = 12;
/** However many phones there are, this many lines a minute is the most the log takes. */
export const TOTAL_PER_MIN = 300;

/** Fixed one-minute windows: simple, and coarse is fine for a log. */
export class ReportLimiter {
  private window = 0;
  private total = 0;
  private readonly byAddress = new Map<string, number>();

  constructor(
    private readonly perAddress = PER_ADDRESS_PER_MIN,
    private readonly overall = TOTAL_PER_MIN,
  ) {}

  allow(address: string, now: number = Date.now()): boolean {
    const window = Math.floor(now / 60_000);
    if (window !== this.window) {
      // A new minute forgets the old one, so the map never outgrows a minute.
      this.window = window;
      this.total = 0;
      this.byAddress.clear();
    }
    const mine = this.byAddress.get(address) ?? 0;
    if (mine >= this.perAddress || this.total >= this.overall) return false;
    this.byAddress.set(address, mine + 1);
    this.total++;
    return true;
  }
}

class TooLarge extends Error {}

/** The body as text, refused once it passes `limit` characters. */
function readLimited(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let done = false;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      if (done) return;
      data += chunk;
      if (data.length > limit) {
        done = true;
        reject(new TooLarge());
      }
    });
    req.on('end', () => {
      if (!done) resolve(data);
    });
    req.on('error', (e) => {
      if (!done) reject(e);
    });
  });
}

/** One report, one log line. */
export function logReport(r: ClientReport): void {
  if (r.kind === 'error') {
    log.warn('client error', { event: 'client-error', viewer: r.viewer, error: r.message, where: r.where, ua: r.ua });
    return;
  }
  const { kind: _kind, ...fields } = r;
  // A phone in trouble is worth a warning; a healthy one is routine.
  const trouble = r.contextLost > 0 || r.errors > 0 || r.stalls > 0;
  (trouble ? log.warn : log.info)('client summary', { event: 'client', ...fields });
}

function reply(res: ServerResponse, code: number): void {
  res.writeHead(code, { 'Cache-Control': 'no-store' });
  res.end();
}

export async function telemetry(
  req: IncomingMessage,
  res: ServerResponse,
  limiter: ReportLimiter,
  address: string,
): Promise<void> {
  if (!limiter.allow(address)) {
    req.resume();
    return reply(res, 429);
  }
  let body: string;
  try {
    body = await readLimited(req, TELEMETRY_BODY_LIMIT);
  } catch (e) {
    return reply(res, e instanceof TooLarge ? 413 : 400);
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return reply(res, 400);
  }
  const parsed = ClientReportSchema.safeParse(json);
  if (!parsed.success) return reply(res, 400);
  logReport(parsed.data);
  reply(res, 204);
}
