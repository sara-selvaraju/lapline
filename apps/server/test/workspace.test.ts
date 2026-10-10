import { describe, expect, it } from 'vitest';
import { PROTOCOL_NAME } from '@lapline/shared';

// Proves the workspace wiring: apps resolve @lapline/shared through its built
// exports, so a broken build order or a bad "exports" map fails here first.
describe('workspace wiring', () => {
  it('resolves @lapline/shared from a consuming app', () => {
    expect(PROTOCOL_NAME).toBe('lapline-prototype-wire');
  });
});
