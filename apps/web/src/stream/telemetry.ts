// What this phone reports about itself: uncaught errors as they happen, and a
// summary about once a minute — frame rate, reconnects, stalls, lost WebGL
// contexts. Each report becomes a line in the server's log, which is the only
// way anyone sees what happened on a phone during a race.
//
// Nothing here may disturb the page. Reports go out with fetch and keepalive,
// failures are ignored rather than retried or reported (a report about a
// failed report could loop), and the frame counter is one requestAnimationFrame
// callback that the browser stops on its own when the page is hidden.

import type { ClientError, ClientSummary } from '@lapline/shared';
import { useStore } from '../store/store.js';

export const SUMMARY_EVERY_MS = 60_000;
/** Errors sent on their own per page load. More are counted in the summary but not sent. */
export const MAX_ERROR_REPORTS = 5;

/** Running counts since the last summary. */
export interface Counts {
  reconnects: number;
  stalls: number;
  contextLost: number;
  errors: number;
  frames: number;
  /** Visible time already banked this period, ms. */
  visibleMs: number;
  /** When the page last became visible, or null while hidden. */
  visibleSince: number | null;
}

export function freshCounts(now: number, visible: boolean): Counts {
  return { reconnects: 0, stalls: 0, contextLost: 0, errors: 0, frames: 0, visibleMs: 0, visibleSince: visible ? now : null };
}

/** Visible time this period up to `now`, ms. */
export function visibleMsAt(c: Counts, now: number): number {
  return c.visibleMs + (c.visibleSince == null ? 0 : now - c.visibleSince);
}

/** The summary for a period. Pure, so the arithmetic is tested. */
export function buildSummary(
  c: Counts,
  now: number,
  meta: { viewer: string; ua: string; layout: ClientSummary['layout'] },
): ClientSummary {
  const visibleMs = visibleMsAt(c, now);
  return {
    kind: 'summary',
    viewer: meta.viewer,
    ua: meta.ua,
    fps: visibleMs >= 1000 ? Math.min(Math.round((c.frames * 1000) / visibleMs), 1000) : null,
    visibleS: Math.min(Math.round(visibleMs / 1000), 3600),
    reconnects: Math.min(c.reconnects, 10_000),
    stalls: Math.min(c.stalls, 10_000),
    contextLost: Math.min(c.contextLost, 10_000),
    errors: Math.min(c.errors, 10_000),
    layout: meta.layout,
  };
}

/** Whether a period is worth reporting: the page was seen, or something went wrong. */
export function worthSending(s: ClientSummary): boolean {
  return s.visibleS > 0 || s.reconnects + s.stalls + s.contextLost + s.errors > 0;
}

/**
 * Whether an error should be sent on its own: not one already sent this page
 * load, and not past the cap, so a render loop throwing every frame costs one
 * report rather than thousands.
 */
export function shouldReportError(sent: Set<string>, message: string, cap = MAX_ERROR_REPORTS): boolean {
  if (sent.has(message) || sent.size >= cap) return false;
  sent.add(message);
  return true;
}

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

function newViewerId(): string {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- the running instance ----------

let counts: Counts | null = null;

/** The stream had to be opened again. Called by stream/sse.ts. */
export function noteReconnect(): void {
  if (counts) counts.reconnects++;
}

/** The stream went quiet long enough to show the stale banner. Called by stream/sse.ts. */
export function noteStall(): void {
  if (counts) counts.stalls++;
}

function layoutNow(): ClientSummary['layout'] {
  if (useStore.getState().glance) return 'glance';
  return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
}

function send(report: ClientSummary | ClientError): void {
  void fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => {});
}

/** Start counting and reporting. Called once, from main.tsx. */
export function startTelemetry(): void {
  if (counts) return;
  const viewer = newViewerId();
  const ua = cut(navigator.userAgent, 160);
  const visible = (): boolean => document.visibilityState === 'visible';
  counts = freshCounts(performance.now(), visible());
  const sentErrors = new Set<string>();

  const flush = (): void => {
    if (!counts) return;
    const now = performance.now();
    const summary = buildSummary(counts, now, { viewer, ua, layout: layoutNow() });
    counts = freshCounts(now, visible());
    if (worthSending(summary)) send(summary);
  };

  const onError = (message: string, where: string): void => {
    if (!counts) return;
    counts.errors++;
    const m = cut(message || 'unknown error', 300);
    if (shouldReportError(sentErrors, m)) send({ kind: 'error', viewer, ua, message: m, where: cut(where, 200) });
  };

  window.addEventListener('error', (e) => {
    onError(e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    onError(r instanceof Error ? r.message : String(r), 'unhandled rejection');
  });
  // The context-lost event does not bubble, so catch it on the way down.
  document.addEventListener(
    'webglcontextlost',
    () => {
      if (counts) counts.contextLost++;
    },
    true,
  );

  document.addEventListener('visibilitychange', () => {
    if (!counts) return;
    const now = performance.now();
    if (visible()) {
      counts.visibleSince ??= now;
    } else {
      counts.visibleMs = visibleMsAt(counts, now);
      counts.visibleSince = null;
      // The page may never come back; send what this period saw now.
      flush();
    }
  });

  const frame = (): void => {
    if (counts) counts.frames++;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  setInterval(flush, SUMMARY_EVERY_MS);
}
