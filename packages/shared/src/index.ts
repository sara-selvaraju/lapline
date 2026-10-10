// Shared protocol surface. M0 carries the prototype's wire shapes as types only;
// zod schemas and protocol v1 land in M1.

export * from './wire.js';
export * from './openf1-rows.js';
export * from './control.js';

/** Identifies the wire format in logs. M1 replaces this with a checked version. */
export const PROTOCOL_NAME = 'lapline-prototype-wire';

/** The SSE event names the feed broadcasts. */
export const SSE_EVENTS = ['init', 'track', 'status', 'tick', 'ping'] as const;
export type SseEvent = (typeof SSE_EVENTS)[number];
