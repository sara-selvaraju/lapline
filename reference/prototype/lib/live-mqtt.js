// OpenF1 live stream over MQTT (WebSocket transport, which passes through most hosting networks).
// The OAuth2 access token is the MQTT password. Tokens last an hour, so the client is
// recreated with a fresh token every 50 minutes and after any disconnect.

const TOPICS = ['location', 'car_data', 'position', 'intervals', 'race_control', 'pit', 'laps', 'stints'];
const URL = process.env.OPENF1_MQTT_URL || 'wss://mqtt.openf1.org:8084/mqtt';

class LiveMqtt {
  constructor(api, onRow) {
    this.api = api;
    this.onRow = onRow;
    this.client = null;
    this.stopped = false;
    this.rotateTimer = null;
    this.retryTimer = null;
  }

  async start() {
    let mqtt;
    try {
      mqtt = require('mqtt');
    } catch {
      console.error('mqtt package not installed; using REST polling for live data');
      return;
    }
    if (this.stopped) return;
    const token = await this.api.getToken(true);
    if (this.stopped) return;
    const client = mqtt.connect(URL, {
      username: this.api.username,
      password: token,
      reconnectPeriod: 0, // reconnects are handled here so each attempt gets a fresh token
      connectTimeout: 15_000,
      clean: true,
    });
    this.client = client;

    client.on('connect', () => {
      console.log('mqtt connected');
      client.subscribe(TOPICS.map((t) => `v1/${t}`), (err) => {
        if (err) console.error('mqtt subscribe', err.message);
      });
    });
    client.on('message', (topic, payload) => {
      const name = topic.replace(/^v1\//, '');
      try {
        this.onRow(name, JSON.parse(payload.toString()));
      } catch (e) {
        console.error('mqtt message', e.message);
      }
    });
    client.on('error', (e) => console.error('mqtt error', e.message));
    client.on('close', () => {
      if (this.client !== client || this.stopped) return;
      this.scheduleRestart(5000);
    });

    clearTimeout(this.rotateTimer);
    this.rotateTimer = setTimeout(() => this.restart(), 50 * 60_000);
  }

  scheduleRestart(ms) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.restart(), ms);
  }

  restart() {
    if (this.stopped) return;
    const old = this.client;
    this.client = null;
    if (old) old.end(true);
    this.start().catch((e) => {
      console.error('mqtt restart', e.message);
      this.scheduleRestart(15_000);
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.rotateTimer);
    clearTimeout(this.retryTimer);
    if (this.client) this.client.end(true);
    this.client = null;
  }
}

module.exports = { LiveMqtt };
