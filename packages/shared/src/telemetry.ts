// POST /api/telemetry: what a phone reports about itself, so the server log
// shows what happened on the phones as well as on the server.
//
// Outside the versioned frame protocol: nothing is streamed back, and an old
// page that never sends a report is fine. Every string is capped, because the
// server writes these to its log and a browser can send anything.

import { z } from 'zod';

const text = (max: number) => z.string().max(max);

/** Every report carries these. */
const base = {
  /** Random per page load, so one phone's reports can be told apart. Never an identity. */
  viewer: z.string().regex(/^[0-9a-f]{8}$/),
  /** navigator.userAgent, cut short. */
  ua: text(160),
};

/** Sent about once a minute while the page is open. */
export const ClientSummarySchema = z.object({
  kind: z.literal('summary'),
  ...base,
  /** Mean frames drawn per second over the visible part of the period; null if never visible. */
  fps: z.number().min(0).max(1000).nullable(),
  /** Seconds of the period the page was visible. */
  visibleS: z.number().min(0).max(3600),
  /** Times the event stream had to be opened again. */
  reconnects: z.number().int().min(0).max(10_000),
  /** Times the stream went quiet long enough to show the stale banner. */
  stalls: z.number().int().min(0).max(10_000),
  /** Times the browser took the WebGL context away. */
  contextLost: z.number().int().min(0).max(10_000),
  /** Errors caught on the page, including those reported on their own. */
  errors: z.number().int().min(0).max(10_000),
  layout: z.enum(['portrait', 'landscape', 'glance']),
});
export type ClientSummary = z.infer<typeof ClientSummarySchema>;

/** Sent as soon as an uncaught error or rejection reaches the page. */
export const ClientErrorSchema = z.object({
  kind: z.literal('error'),
  ...base,
  message: text(300),
  /** file:line:column, when the browser gives one. */
  where: text(200),
});
export type ClientError = z.infer<typeof ClientErrorSchema>;

export const ClientReportSchema = z.discriminatedUnion('kind', [ClientSummarySchema, ClientErrorSchema]);
export type ClientReport = z.infer<typeof ClientReportSchema>;

/** Bodies larger than this are refused before parsing. */
export const TELEMETRY_BODY_LIMIT = 4_000;
