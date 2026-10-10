import { afterEach, describe, expect, it, vi } from 'vitest';
import { LockedError, OpenF1 } from '../src/openf1/client.js';

const BASE = 'http://openf1.test';

interface Call {
  url: string;
  headers: Record<string, string>;
  at: number;
}

/**
 * Stubs fetch with a scripted sequence of responses. Token requests are answered
 * separately so they never consume a scripted row, matching the real client,
 * where the token endpoint sits outside the request queue.
 */
function stubFetch(
  responses: Array<{ status: number; body?: unknown; text?: string } | 'network-error'>,
  opts: { tokenStatus?: number } = {},
): { calls: Call[]; tokenCalls: number } {
  const calls: Call[] = [];
  const state = { tokenCalls: 0 };
  let i = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/token')) {
      state.tokenCalls++;
      const status = opts.tokenStatus ?? 200;
      return new Response(
        status === 200 ? JSON.stringify({ access_token: `tok-${state.tokenCalls}`, expires_in: '3600' }) : 'nope',
        { status },
      );
    }
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      at: Date.now(),
    });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r === 'network-error') throw new TypeError('fetch failed');
    return new Response(r.body !== undefined ? JSON.stringify(r.body) : (r.text ?? ''), { status: r.status });
  });
  return { calls, get tokenCalls() { return state.tokenCalls; } } as { calls: Call[]; tokenCalls: number };
}

afterEach(() => vi.unstubAllGlobals());

const free = (minGapMs = 0): OpenF1 => new OpenF1({ baseUrl: BASE, minGapMs });
const sponsor = (minGapMs = 0): OpenF1 =>
  new OpenF1({ baseUrl: BASE, minGapMs, username: 'u', password: 'p' });

describe('404 means no rows', () => {
  it('resolves to an empty array rather than throwing', async () => {
    stubFetch([{ status: 404, body: { detail: 'No results found.' } }]);
    await expect(free().get('laps')).resolves.toEqual([]);
  });

  it('counts no error for a 404', async () => {
    stubFetch([{ status: 404, body: {} }]);
    const api = free();
    await api.get('laps');
    expect(api.stats.errors).toBe(0);
    expect(api.stats.last).toBe('404 laps');
  });
});

describe('the live-window lock', () => {
  it('throws LockedError with the free-tier message on 401 without credentials', async () => {
    stubFetch([{ status: 401, body: { detail: 'Authentication required for live data' } }]);
    const err = await free().get('location').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LockedError);
    expect((err as Error).message).toContain('needs OpenF1 sponsor credentials');
  });

  it('does not retry a 401 when it had no token to refresh', async () => {
    const f = stubFetch([{ status: 401, body: {} }]);
    await free().get('location').catch(() => {});
    expect(f.calls).toHaveLength(1);
  });

  it('retries once on a fresh token when credentials are set, then throws', async () => {
    const f = stubFetch([{ status: 401, body: {} }]);
    const err = await sponsor().get('location').catch((e: unknown) => e);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.headers.Authorization).toBe('Bearer tok-1');
    // The retry carries a newly forced token, not the stale one.
    expect(f.calls[1]!.headers.Authorization).toBe('Bearer tok-2');
    expect(err).toBeInstanceOf(LockedError);
    expect((err as Error).message).toContain('rejected the credentials');
  });

  it('treats 403 the same as 401', async () => {
    stubFetch([{ status: 403, body: {} }]);
    await expect(free().get('location')).rejects.toBeInstanceOf(LockedError);
  });
});

describe('retries', () => {
  it('backs off on 429 and succeeds on a later attempt', async () => {
    const f = stubFetch([{ status: 429, text: 'slow down' }, { status: 200, body: [{ a: 1 }] }]);
    const api = new OpenF1({ baseUrl: BASE, minGapMs: 0 });
    // Shorten the 5 s backoff so the test does not wait on it.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    await expect(api.get('laps')).resolves.toEqual([{ a: 1 }]);
    expect(f.calls).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it('retries a 5xx twice, then throws with the status and endpoint', async () => {
    const f = stubFetch([{ status: 503, text: 'upstream down' }]);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    const err = await free().get('laps').catch((e: unknown) => e);
    expect(f.calls).toHaveLength(3);
    expect((err as Error).message).toContain('OpenF1 503 on laps');
    vi.restoreAllMocks();
  });

  it('retries a network failure twice, then rethrows', async () => {
    const f = stubFetch(['network-error']);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
    await expect(free().get('laps')).rejects.toThrow('fetch failed');
    expect(f.calls).toHaveLength(3);
    vi.restoreAllMocks();
  });

  it('does not throw a 400 away as a retry', async () => {
    const f = stubFetch([{ status: 400, text: 'bad filter' }]);
    await expect(free().get('laps')).rejects.toThrow('OpenF1 400 on laps');
    expect(f.calls).toHaveLength(1);
  });
});

describe('response shape', () => {
  it('returns rows unchanged', async () => {
    stubFetch([{ status: 200, body: [{ driver_number: 4 }, { driver_number: 81 }] }]);
    await expect(free().get('drivers')).resolves.toHaveLength(2);
  });

  it('returns an empty array when the body is not an array', async () => {
    stubFetch([{ status: 200, body: { detail: 'unexpected' } }]);
    await expect(free().get('drivers')).resolves.toEqual([]);
  });
});

describe('the single request queue', () => {
  it('runs concurrent gets one at a time, never overlapping', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal('fetch', async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response('[]', { status: 200 });
    });
    const api = free();
    await Promise.all([api.get('a'), api.get('b'), api.get('c')]);
    expect(maxInFlight).toBe(1);
    expect(api.stats.requests).toBe(3);
  });

  it('keeps the queue running after a request fails', async () => {
    const f = stubFetch([{ status: 400, text: 'bad' }, { status: 200, body: [{ ok: true }] }]);
    const api = free();
    const first = api.get('a').catch(() => 'failed');
    const second = api.get('b');
    expect(await first).toBe('failed');
    await expect(second).resolves.toEqual([{ ok: true }]);
    expect(f.calls).toHaveLength(2);
  });

  it('spaces request starts by minGapMs', async () => {
    const f = stubFetch([{ status: 200, body: [] }]);
    const api = new OpenF1({ baseUrl: BASE, minGapMs: 60 });
    await api.get('a');
    await api.get('b');
    await api.get('c');
    expect(f.calls[1]!.at - f.calls[0]!.at).toBeGreaterThanOrEqual(55);
    expect(f.calls[2]!.at - f.calls[1]!.at).toBeGreaterThanOrEqual(55);
  });
});

describe('tier defaults', () => {
  it('spaces at 2100 ms without credentials and 1100 ms with them', () => {
    delete process.env.OPENF1_MIN_GAP_MS;
    expect(new OpenF1({ baseUrl: BASE }).minGapMs).toBe(2100);
    expect(new OpenF1({ baseUrl: BASE, username: 'u', password: 'p' }).minGapMs).toBe(1100);
  });

  it('lets OPENF1_MIN_GAP_MS override the tier default', () => {
    process.env.OPENF1_MIN_GAP_MS = '25';
    try {
      expect(new OpenF1({ baseUrl: BASE }).minGapMs).toBe(25);
    } finally {
      delete process.env.OPENF1_MIN_GAP_MS;
    }
  });

  it('reports whether credentials are configured', () => {
    expect(free().hasCredentials).toBe(false);
    expect(sponsor().hasCredentials).toBe(true);
    expect(new OpenF1({ baseUrl: BASE, username: 'u' }).hasCredentials).toBe(false);
  });
});

describe('authentication', () => {
  it('sends no Authorization header on the free tier', async () => {
    const f = stubFetch([{ status: 200, body: [] }]);
    await free().get('sessions');
    expect(f.calls[0]!.headers.Authorization).toBeUndefined();
    expect(f.tokenCalls).toBe(0);
  });

  it('sends a bearer token when credentials are set', async () => {
    const f = stubFetch([{ status: 200, body: [] }]);
    await sponsor().get('location');
    expect(f.calls[0]!.headers.Authorization).toBe('Bearer tok-1');
  });

  it('reuses the token across requests rather than fetching one each time', async () => {
    const f = stubFetch([{ status: 200, body: [] }]);
    const api = sponsor();
    await api.get('a');
    await api.get('b');
    expect(f.tokenCalls).toBe(1);
  });

  it('carries on unauthenticated when the token request fails', async () => {
    const f = stubFetch([{ status: 200, body: [] }], { tokenStatus: 500 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sponsor().get('location')).resolves.toEqual([]);
    expect(f.calls[0]!.headers.Authorization).toBeUndefined();
    vi.restoreAllMocks();
  });
});
