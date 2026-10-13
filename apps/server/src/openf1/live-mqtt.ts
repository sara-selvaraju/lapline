// OpenF1 live stream over MQTT.
//
// WebSocket transport, which passes through hosting networks more reliably than
// raw MQTTS. The OAuth2 access token is the MQTT password, and tokens last an
// hour, so the client is recreated with a fresh token every 50 minutes and after
// any disconnect. Reconnects are handled here rather than by the library, so
// every attempt gets a new token.
//
// Verified against OpenF1's real broker during the Singapore race on 11
// October 2026: 22 cars at 4 Hz with a 2 s data age — see docs/OPENF1.md. If it
// misbehaves, set LIVE_TRANSPORT=rest.
//
// Ported from reference/prototype/lib/live-mqtt.js.

import type { OpenF1 } from './client.js';

/** Topics mirror the REST paths. */
const TOPICS = ['location', 'car_data', 'position', 'intervals', 'race_control', 'pit', 'laps', 'stints'];

export const DEFAULT_BROKER_URL = 'wss://mqtt.openf1.org:8084/mqtt';

/** Read at construction, not import, so tests can point it somewhere harmless. */
const brokerUrl = (): string => process.env.OPENF1_MQTT_URL || DEFAULT_BROKER_URL;

/** Recreate the client before the one-hour token expires. */
const ROTATE_MS = 50 * 60_000;

export type RowHandler = (topic: string, row: unknown) => void;

interface MqttLike {
  on(event: 'connect' | 'close', fn: () => void): void;
  on(event: 'error', fn: (e: Error) => void): void;
  on(event: 'message', fn: (topic: string, payload: Uint8Array) => void): void;
  subscribe(topics: string[], cb: (err: Error | null) => void): void;
  end(force?: boolean): void;
}

export class LiveMqtt {
  private client: MqttLike | null = null;
  private stopped = false;
  private rotateTimer: NodeJS.Timeout | undefined;
  private retryTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly api: OpenF1,
    private readonly onRow: RowHandler,
    private readonly url: string = brokerUrl(),
  ) {}

  async start(): Promise<void> {
    let mqtt;
    try {
      mqtt = await import('mqtt');
    } catch {
      console.error('mqtt package not installed; using REST polling for live data');
      return;
    }
    if (this.stopped) return;

    // Force a fresh token: this connection has to outlive the REST one.
    const token = await this.api.getToken(true);
    if (this.stopped) return;

    const client = mqtt.default.connect(this.url, {
      username: this.api.username,
      password: token ?? undefined,
      reconnectPeriod: 0, // reconnects are handled here, so each attempt gets a fresh token
      connectTimeout: 15_000,
      clean: true,
    }) as unknown as MqttLike;
    this.client = client;

    client.on('connect', () => {
      console.log('mqtt connected');
      client.subscribe(
        TOPICS.map((t) => `v1/${t}`),
        (err: Error | null) => {
          if (err) console.error('mqtt subscribe', err.message);
        },
      );
    });

    client.on('message', (topic: string, payload: Uint8Array) => {
      const name = topic.replace(/^v1\//, '');
      try {
        this.onRow(name, JSON.parse(Buffer.from(payload).toString()));
      } catch (e) {
        console.error('mqtt message', e instanceof Error ? e.message : String(e));
      }
    });

    client.on('error', (e: Error) => console.error('mqtt error', e.message));

    client.on('close', () => {
      // Ignore the close of a client we have already replaced.
      if (this.client !== client || this.stopped) return;
      this.scheduleRestart(5000);
    });

    clearTimeout(this.rotateTimer);
    this.rotateTimer = setTimeout(() => this.restart(), ROTATE_MS);
  }

  /**
   * Try again later, for a caller that owns the first `start()`. Without this
   * a token refused on the very first attempt — the broker down, the network
   * not up yet — meant no MQTT for the rest of the session, because only
   * `restart()` knew how to retry.
   */
  retryLater(ms = 15_000): void {
    if (this.stopped) return;
    this.scheduleRestart(ms);
  }

  private scheduleRestart(ms: number): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.restart(), ms);
  }

  private restart(): void {
    if (this.stopped) return;
    const old = this.client;
    this.client = null;
    if (old) old.end(true);
    void this.start().catch((e: unknown) => {
      console.error('mqtt restart', e instanceof Error ? e.message : String(e));
      this.scheduleRestart(15_000);
    });
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.rotateTimer);
    clearTimeout(this.retryTimer);
    if (this.client) this.client.end(true);
    this.client = null;
  }
}
