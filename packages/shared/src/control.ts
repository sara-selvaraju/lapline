// POST /api/control. Validated server-side, because it is the one place a
// browser sends us anything.

import { z } from 'zod';

export const ControlRequestSchema = z.object({
  /** Select a session by key. Checked first, so it wins over the fields below. */
  session: z.number().int().optional(),
  /** Force a mode on that session; 'replay' is "replay from start". */
  mode: z.enum(['replay', 'live']).optional(),
  /** 'auto' clears the manual pick and follows whichever session is live. */
  follow: z.literal('auto').optional(),
  playing: z.boolean().optional(),
  /** Clamped server-side to 0.25-32. */
  speed: z.number().optional(),
  /** Session time in epoch ms; a jump over 5 s refetches. */
  at: z.number().optional(),
  /** Clamped server-side to 3-180 s. */
  delayS: z.number().optional(),
});
export type ControlRequest = z.infer<typeof ControlRequestSchema>;

export interface ControlResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}
