import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, SSE_EVENTS } from '@lapline/shared';

// Proves the workspace wiring: apps resolve @lapline/shared through its built
// exports, so a broken build order or a bad "exports" map fails here first.
describe('workspace wiring', () => {
  it('resolves @lapline/shared from a consuming app', () => {
    // Deliberately not pinned to a number: the exact version belongs in the
    // protocol's own test, so a bump does not need editing in two places.
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('agrees on the event names both sides use', () => {
    expect(SSE_EVENTS).toEqual(['hello', 'tick', 'timing', 'status', 'circuit', 'ping']);
  });
});
