// POST /api/control, as reference/prototype/server.js accepts it.

export interface ControlRequest {
  /** Select a session by key. Checked first, so it wins over the fields below. */
  session?: number;
  /** Force a mode on that session; 'replay' is "replay from start". */
  mode?: 'replay' | 'live';
  /** 'auto' clears the manual pick and follows whichever session is live. */
  follow?: 'auto';
  /** Replay only. */
  playing?: boolean;
  /** Replay only. Clamped server-side to 0.25–32. */
  speed?: number;
  /** Replay only. Session time in epoch ms; a jump over 5 s refetches. */
  at?: number;
  /** Live only. Clamped server-side to 3–180 s. */
  delayS?: number;
}

export interface ControlResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}
