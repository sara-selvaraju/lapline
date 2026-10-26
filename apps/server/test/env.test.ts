// The warning for a server with no password in front of real data.

import { describe, expect, it } from 'vitest';
import { openGateWarning } from '../src/env.js';

describe('openGateWarning', () => {
  it('says nothing when there is a password', () => {
    expect(openGateWarning({ appPassword: 'x', openf1Base: undefined })).toBeNull();
  });

  it('says nothing against the mock, which is every development run', () => {
    expect(openGateWarning({ appPassword: '', openf1Base: 'http://localhost:4001' })).toBeNull();
    expect(openGateWarning({ appPassword: '', openf1Base: 'http://127.0.0.1:4001/' })).toBeNull();
  });

  it('warns with no password against real OpenF1, named or by default', () => {
    expect(openGateWarning({ appPassword: '', openf1Base: undefined })).toMatch(/APP_PASSWORD/);
    expect(openGateWarning({ appPassword: '', openf1Base: '' })).toMatch(/APP_PASSWORD/);
    expect(openGateWarning({ appPassword: '', openf1Base: 'https://api.openf1.org' })).toMatch(/APP_PASSWORD/);
  });
});
