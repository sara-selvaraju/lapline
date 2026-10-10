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
