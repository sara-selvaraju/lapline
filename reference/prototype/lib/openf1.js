// Minimal OpenF1 REST client.
// - Serialises requests through one queue so the whole app stays inside the rate limit
//   (free: 3 req/s and 30 req/min; sponsor: 6 req/s and 60 req/min).
// - Handles the OAuth2 password flow when sponsor credentials are configured.

const BASE = (process.env.OPENF1_BASE || 'https://api.openf1.org').replace(/\/$/, '');

class LockedError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'LockedError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class OpenF1 {
  constructor({ username, password } = {}) {
    this.username = username || '';
    this.password = password || '';
    this.token = null;
    this.tokenExp = 0;
    // Gap between request starts. 2.1 s keeps the free tier under 30/min, 1.1 s keeps sponsors under 60/min.
    this.minGapMs = Number(process.env.OPENF1_MIN_GAP_MS) || (this.hasCredentials ? 1100 : 2100);
    this.chain = Promise.resolve();
    this.lastStart = 0;
    this.stats = { requests: 0, errors: 0, last: null };
  }

  get hasCredentials() {
    return Boolean(this.username && this.password);
  }

  async getToken(force = false) {
    if (!this.hasCredentials) return null;
    if (!force && this.token && Date.now() < this.tokenExp - 60_000) return this.token;
    const body = new URLSearchParams({ username: this.username, password: this.password });
    const res = await fetch(`${BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`OpenF1 token request failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    this.token = data.access_token;
    this.tokenExp = Date.now() + Number(data.expires_in || 3600) * 1000;
    return this.token;
  }

  // filters: array of [field, op, value], op one of = > >= < <=
  buildUrl(path, filters = []) {
    const parts = filters.map(([k, op, v]) => {
      const enc = op === '=' ? '=' : encodeURIComponent(op.replace('=', '')) + (op.endsWith('=') ? '=' : '');
      return `${k}${enc}${encodeURIComponent(v)}`;
    });
    return `${BASE}/v1/${path}${parts.length ? '?' + parts.join('&') : ''}`;
  }

  get(path, filters = []) {
    const run = this.chain.then(() => this._get(path, filters));
    this.chain = run.catch(() => {});
    return run;
  }

  async _get(path, filters, attempt = 0) {
    const wait = this.lastStart + this.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastStart = Date.now();
    this.stats.requests++;

    const url = this.buildUrl(path, filters);
    const headers = { accept: 'application/json' };
    const token = await this.getToken().catch((e) => {
      console.error(e.message);
      return null;
    });
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      this.stats.errors++;
      if (attempt < 2) {
        await sleep(2000);
        return this._get(path, filters, attempt + 1);
      }
      throw e;
    }
    this.stats.last = `${res.status} ${path}`;

    if (res.status === 404) return []; // OpenF1 answers "no results" with 404
    if (res.status === 429 && attempt < 3) {
      this.stats.errors++;
      await sleep(5000 * (attempt + 1));
      return this._get(path, filters, attempt + 1);
    }
    if (res.status === 401 || res.status === 403) {
      this.stats.errors++;
      if (token && attempt === 0) {
        await this.getToken(true).catch(() => {});
        return this._get(path, filters, attempt + 1);
      }
      throw new LockedError(
        this.hasCredentials
          ? 'OpenF1 rejected the credentials for live data.'
          : 'This session is inside the live window, which needs OpenF1 sponsor credentials.'
      );
    }
    if (!res.ok) {
      this.stats.errors++;
      if (res.status >= 500 && attempt < 2) {
        await sleep(3000);
        return this._get(path, filters, attempt + 1);
      }
      throw new Error(`OpenF1 ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }
}

module.exports = { OpenF1, LockedError, BASE };
