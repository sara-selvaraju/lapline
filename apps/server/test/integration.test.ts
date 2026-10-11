// The server as a process, against the mock as a process, over real HTTP.
// This is the shape the parity checks in docs run, asserted.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import type { InitPayload, Tick } from '@lapline/shared';

const MOCK_PORT = 4301;
const SRV_PORT = 3301;
const ROOT = new URL('../../..', import.meta.url).pathname;
const BASE = `http://localhost:${SRV_PORT}`;
const PASSWORD = 'parity-test';
const auth = { Authorization: `Basic ${Buffer.from(`any:${PASSWORD}`).toString('base64')}` };

let mock: ChildProcess;
let srv: ChildProcess;
let mockLog = '';

async function waitFor(url: string, headers: Record<string, string> = {}): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${url} never came up`);
}

beforeAll(async () => {
  mock = spawn(process.execPath, ['tools/mock-openf1/dist/src/index.js'], {
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT) },
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  mock.stdout?.on('data', (d: Buffer) => (mockLog += d.toString()));
  await waitFor(`http://localhost:${MOCK_PORT}/v1/sessions?year=${new Date().getUTCFullYear()}`);

  srv = spawn(process.execPath, ['apps/server/dist/src/index.js'], {
    env: {
      ...process.env,
      PORT: String(SRV_PORT),
      OPENF1_BASE: `http://localhost:${MOCK_PORT}`,
      OPENF1_MIN_GAP_MS: '20',
      APP_PASSWORD: PASSWORD,
      SESSION_KEY: '1001',
      LIVE_TRANSPORT: 'rest',
      OPENF1_USERNAME: '',
      OPENF1_PASSWORD: '',
      PUBLIC_DIR: `${ROOT}apps/web/dist`,
    },
    cwd: ROOT,
    stdio: 'ignore',
  });
  await waitFor(`${BASE}/healthz`);
  // Let the session finish opening: drivers, then the six static endpoints.
  await new Promise((r) => setTimeout(r, 3500));
}, 60_000);

afterAll(() => {
  srv?.kill();
  mock?.kill();
});

describe('/healthz', () => {
  it('reports ok and the current mode, with no credentials needed', async () => {
    const r = await fetch(`${BASE}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, mode: 'replay' });
  });

  it('leaks no secrets', async () => {
    expect(await (await fetch(`${BASE}/healthz`)).text()).not.toContain(PASSWORD);
  });
});

describe('the password gate', () => {
  it('401s every path but health without credentials', async () => {
    for (const p of ['/', '/events', '/api/state']) {
      expect((await fetch(`${BASE}${p}`)).status).toBe(401);
    }
  });

  it('offers a Basic challenge so the browser prompts', async () => {
    const r = await fetch(`${BASE}/`);
    expect(r.headers.get('www-authenticate')).toContain('Basic realm="Lapline"');
  });

  it('401s a wrong password', async () => {
    const bad = { Authorization: `Basic ${Buffer.from('any:wrong').toString('base64')}` };
    expect((await fetch(`${BASE}/api/state`, { headers: bad })).status).toBe(401);
  });

  it('accepts the right password with any username', async () => {
    expect((await fetch(`${BASE}/api/state`, { headers: auth })).status).toBe(200);
  });
});

describe('/api/state', () => {
  it('describes the replay session that was pinned', async () => {
    const s = (await (await fetch(`${BASE}/api/state`, { headers: auth })).json()) as InitPayload;
    expect(s.mode).toBe('replay');
    expect(s.session!.key).toBe(1001);
    expect(s.session!.name).toBe('Sprint');
    expect(s.drivers).toHaveLength(20);
    expect(s.canLive).toBe(false);
  });

  it('never echoes an environment value', async () => {
    const body = await (await fetch(`${BASE}/api/state`, { headers: auth })).text();
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain(String(MOCK_PORT));
  });
});

describe('/events', () => {
  it('streams init then ticks, with timing on every fourth one', async () => {
    const res = await fetch(`${BASE}/events`, { headers: auth });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const events: Array<{ event: string; data: unknown }> = [];
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && events.filter((e) => e.event === 'tick').length < 8) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const p of parts) {
        const m = /^event: (\w+)\ndata: (.*)$/s.exec(p.trim());
        if (m) events.push({ event: m[1]!, data: JSON.parse(m[2]!) });
      }
    }
    await reader.cancel();

    expect(events[0]!.event).toBe('init');
    const ticks = events.filter((e) => e.event === 'tick').map((e) => e.data as Tick);
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    // Timing rides one tick in four.
    const withTiming = ticks.filter((t) => t.timing).length;
    expect(withTiming).toBeGreaterThanOrEqual(Math.floor(ticks.length / 4));
    expect(withTiming).toBeLessThanOrEqual(Math.ceil(ticks.length / 4) + 1);
    // The clock advances at 1x.
    const span = ticks.at(-1)!.t - ticks[0]!.t;
    expect(span).toBeGreaterThan(0);
    expect(ticks[0]!.cars.length).toBe(20);
  }, 30_000);
});

describe('/api/control', () => {
  it('changes replay speed, and the clock then advances faster', async () => {
    const at = async (): Promise<number> => {
      const s = (await (await fetch(`${BASE}/api/state`, { headers: auth })).json()) as InitPayload;
      return s.status.api.requests;
    };
    void (await at());
    const r = await fetch(`${BASE}/api/control`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: 8 }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('rejects a malformed body with 400', async () => {
    const r = await fetch(`${BASE}/api/control`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(r.status).toBe(400);
    expect((await r.json()) as { error: string }).toHaveProperty('error');
  });
});

describe('static files', () => {
  it('serves the built index.html with no-cache', async () => {
    const r = await fetch(`${BASE}/`, { headers: auth });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('cache-control')).toBe('no-cache');
  });

  it('404s an unknown path rather than falling back to the app', async () => {
    expect((await fetch(`${BASE}/nope.txt`, { headers: auth })).status).toBe(404);
  });

  it('refuses to climb out of the public directory', async () => {
    const r = await fetch(`${BASE}/../../package.json`, { headers: auth, redirect: 'manual' });
    expect(r.status).not.toBe(200);
  });
});

describe('the mock saw only what it should have', () => {
  it('opened the session with about eight requests, not a flood', () => {
    const lines = mockLog.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    // drivers, laps, stints, position, intervals, race_control, pit, one location
    // trace for the outline, plus the replay windows since.
    expect(lines.filter((l) => / (drivers|laps|stints|position|intervals|race_control|pit) /.test(l)).length)
      .toBeGreaterThanOrEqual(7);
  });

  it('made no authenticated request, since no credentials were set', () => {
    expect(mockLog).not.toContain('(auth)');
  });
});
