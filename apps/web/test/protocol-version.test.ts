// The rule for reloading when the server speaks a different protocol.
//
// A deploy that changes the wire format leaves open pages running the old
// client. They cannot read the new messages, so they reload to fetch the
// matching bundle. The guard stops that becoming a loop.

import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@lapline/shared';
import { shouldReloadForProtocol } from '../src/stream/sse.js';

describe('shouldReloadForProtocol', () => {
  it('does nothing when the versions agree', () => {
    expect(shouldReloadForProtocol(2, 2, false)).toBe(false);
  });

  it('reloads when the server is ahead, as after a deploy', () => {
    expect(shouldReloadForProtocol(3, 2, false)).toBe(true);
  });

  it('reloads when the server is behind, as during a rollback', () => {
    expect(shouldReloadForProtocol(1, 2, false)).toBe(true);
  });

  it('reloads only once, so a server stuck on the wrong version cannot loop the page', () => {
    expect(shouldReloadForProtocol(1, 2, true)).toBe(false);
  });

  it('is wired to the version this client was built against', () => {
    expect(shouldReloadForProtocol(PROTOCOL_VERSION, PROTOCOL_VERSION, false)).toBe(false);
    expect(shouldReloadForProtocol(PROTOCOL_VERSION + 1, PROTOCOL_VERSION, false)).toBe(true);
  });
});
