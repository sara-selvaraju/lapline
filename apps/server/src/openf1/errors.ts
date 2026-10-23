/**
 * Thrown when OpenF1 refuses data that needs credentials we do not have, or that
 * it would not accept. The feed turns this into `locked` mode rather than an
 * error, because inside the live window a 401 is the expected answer on the free
 * tier, not a fault.
 */
export class LockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockedError';
  }
}

/**
 * OpenF1 answered with an error we could not retry our way past. The message
 * is short enough for a screen; `detail` holds the start of the response body
 * — for a 502 that is nginx's HTML page — and belongs in the log only.
 */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string,
  ) {
    super(`OpenF1 ${status} on ${path}`);
    this.name = 'UpstreamError';
  }
}
