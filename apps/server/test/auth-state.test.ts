// Whether authentication is working, as opposed to merely configured.
//
// The distinction is not academic: a credential with a stray space in it is
// configured and rejected, and reporting that as authenticated tells a viewer
// live data is available when every request will be refused.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenF1 } from '../src/openf1/client.js';

const BASE = 'http://openf1.test';

function stub(tokenStatus: number): void {
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).endsWith('/token')) {
      return new Response(
        tokenStatus === 200 ? JSON.stringify({ access_token: 'tok', expires_in: '3600' }) : '{"detail":"Incorrect username or password"}',
        { status: tokenStatus },
      );
    }
    return new Response('[]', { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('authState', () => {
  it('is none without credentials', () => {
    expect(new OpenF1({ baseUrl: BASE }).authState).toBe('none');
  });

  it('is pending once credentials are set but nothing has been tried', () => {
    expect(new OpenF1({ baseUrl: BASE, username: 'u', password: 'p' }).authState).toBe('pending');
  });

  it('is ok after a token request succeeds', async () => {
    stub(200);
    const api = new OpenF1({ baseUrl: BASE, minGapMs: 0, username: 'u', password: 'p' });
    await api.get('drivers');
    expect(api.authState).toBe('ok');
  });

  it('is rejected after OpenF1 refuses the credentials', async () => {
    stub(401);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = new OpenF1({ baseUrl: BASE, minGapMs: 0, username: 'u', password: 'p' });
    await api.get('drivers');
    expect(api.authState).toBe('rejected');
  });

  it('still serves free data when the credentials are refused', async () => {
    // This is the behaviour that kept the deployed site working with a bad
    // credential: log it, carry on unauthenticated, serve what is free.
    stub(401);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = new OpenF1({ baseUrl: BASE, minGapMs: 0, username: 'u', password: 'p' });
    await expect(api.get('drivers')).resolves.toEqual([]);
    expect(api.authState).toBe('rejected');
  });

  it('recovers to ok once a later token request succeeds', async () => {
    stub(401);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = new OpenF1({ baseUrl: BASE, minGapMs: 0, username: 'u', password: 'p' });
    await api.get('drivers');
    expect(api.authState).toBe('rejected');

    stub(200);
    await api.getToken(true);
    expect(api.authState).toBe('ok');
  });

  it('reports hasCredentials separately, since they are different questions', () => {
    const api = new OpenF1({ baseUrl: BASE, username: 'u', password: 'p' });
    expect(api.hasCredentials).toBe(true);
    expect(api.authState).toBe('pending');
  });
});
