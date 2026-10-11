// The live transport choice, and what happens when MQTT is unavailable.
//
// The broker path itself is unverified: docs/OPENF1.md records that MQTT has only
// ever been tested against a local broker, and M9 verifies it during a real
// session. What is tested here is the part that matters if it misbehaves — the
// live stream must keep running on REST either way.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Tick, Timing } from '@lapline/shared';
import { OpenF1 } from '../src/openf1/client.js';
import { DEFAULT_BROKER_URL, LiveMqtt } from '../src/openf1/live-mqtt.js';
import { Feed } from '../src/feed/feed.js';

const PORT = 4401;
const BASE = `http://localhost:${PORT}`;
const RACE = 1002;
let mock: ChildProcess;

beforeAll(async () => {
  mock = spawn(process.execPath, ['tools/mock-openf1/dist/src/index.js'], {
    env: { ...process.env, MOCK_PORT: String(PORT) },
    cwd: new URL('../../..', import.meta.url).pathname,
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/v1/sessions?year=${new Date().getUTCFullYear()}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('mock did not start');
}, 20_000);

afterAll(() => mock?.kill());

const sponsorApi = (): OpenF1 =>
  new OpenF1({ baseUrl: BASE, minGapMs: 0, username: 'any', password: 'any' });

describe('transport selection', () => {
  it('reports mqtt false and polls REST when LIVE_TRANSPORT=rest', async () => {
    const feed = new Feed(sponsorApi(), { liveTransport: 'rest' });
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      await feed.fetchStep();
      const frame = feed.tick() as Tick;
      expect(frame.live!.mqtt).toBe(false);
      expect(frame.cars.length).toBeGreaterThan(0);
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('does not start MQTT without credentials, since the token is its password', async () => {
    const feed = new Feed(new OpenF1({ baseUrl: BASE, minGapMs: 0 }), { liveTransport: 'mqtt' });
    try {
      await feed.loadSessionList();
      // The free tier is locked inside the live window, so there is nothing to connect for.
      await feed.selectSession(RACE);
      expect(feed.mode).toBe('locked');
    } finally {
      feed.stop();
    }
  }, 30_000);

  it('keeps streaming over REST when the broker cannot be reached', async () => {
    // Port 1 refuses immediately, standing in for a broker that is down.
    const prev = process.env.OPENF1_MQTT_URL;
    process.env.OPENF1_MQTT_URL = 'ws://localhost:1/mqtt';
    const feed = new Feed(sponsorApi(), { liveTransport: 'mqtt' });
    try {
      await feed.loadSessionList();
      await feed.selectSession(RACE);
      expect(feed.mode).toBe('live');
      // MQTT never goes healthy, so the scheduler runs the full REST plan.
      await feed.fetchStep();
      await feed.fetchStep();
      const frame = feed.tick() as Tick;
      expect(frame.live!.mqtt).toBe(false);
      expect(frame.cars.length).toBeGreaterThan(0);
      expect((feed.timing() as Timing).rows).toHaveLength(20);
    } finally {
      feed.stop();
      if (prev === undefined) delete process.env.OPENF1_MQTT_URL;
      else process.env.OPENF1_MQTT_URL = prev;
    }
  }, 30_000);
});

describe('LiveMqtt', () => {
  it('defaults to OpenF1 WebSocket broker, which passes through hosting networks', () => {
    expect(DEFAULT_BROKER_URL).toBe('wss://mqtt.openf1.org:8084/mqtt');
  });

  it('takes its URL from the environment at construction, not at import', () => {
    const prev = process.env.OPENF1_MQTT_URL;
    process.env.OPENF1_MQTT_URL = 'ws://example.test/mqtt';
    try {
      const client = new LiveMqtt(sponsorApi(), () => {});
      expect(Reflect.get(client, 'url')).toBe('ws://example.test/mqtt');
    } finally {
      if (prev === undefined) delete process.env.OPENF1_MQTT_URL;
      else process.env.OPENF1_MQTT_URL = prev;
    }
  });

  it('stops cleanly before it has connected', () => {
    const client = new LiveMqtt(sponsorApi(), () => {}, 'ws://localhost:1/mqtt');
    expect(() => client.stop()).not.toThrow();
  });
});
