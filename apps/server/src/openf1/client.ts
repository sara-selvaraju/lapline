// The one OpenF1 REST client for the process.
//
// Every request goes through a single queue, so the whole app stays inside the
// rate limit no matter how many viewers are connected: 3 a second and 30 a minute
// on the free tier, 6 and 60 with sponsor credentials. Do not add a second client.
//
// Ported from reference/prototype/lib/openf1.js.

import { LockedError } from './errors.js';
import { buildUrl, normaliseBase, type Filter } from './url.js';

export interface OpenF1Options {
  username?: string | undefined;
  password?: string | undefined;
  /** Defaults to OPENF1_BASE, then the real API. Injected by tests. */
  baseUrl?: string | undefined;
  /** Overrides the tier default and OPENF1_MIN_GAP_MS. Injected by tests. */
  minGapMs?: number | undefined;
}

export interface OpenF1Stats {
  requests: number;
  errors: number;
  /** `"<status> <endpoint>"` for the most recent response. */
  last: string | null;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: string | number;
  token_type?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class OpenF1 {
  readonly username: string;
  private readonly password: string;
  readonly baseUrl: string;
  /** Gap between request starts: 2.1 s keeps the free tier under 30/min, 1.1 s sponsors under 60/min. */
  readonly minGapMs: number;
  readonly stats: OpenF1Stats = { requests: 0, errors: 0, last: null };

  private token: string | null = null;
  private tokenExp = 0;
  /** The queue. Each request chains off the last, so only one is ever in flight. */
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor({ username, password, baseUrl, minGapMs }: OpenF1Options = {}) {
    this.username = username || '';
    this.password = password || '';
    this.baseUrl = normaliseBase(baseUrl ?? process.env.OPENF1_BASE);
    this.minGapMs =
      minGapMs ?? (Number(process.env.OPENF1_MIN_GAP_MS) || (this.hasCredentials ? 1100 : 2100));
  }

  get hasCredentials(): boolean {
    return Boolean(this.username && this.password);
  }

  /** OAuth2 password flow. Tokens last an hour; refresh a minute before expiry. */
  async getToken(force = false): Promise<string | null> {
    if (!this.hasCredentials) return null;
    if (!force && this.token && Date.now() < this.tokenExp - 60_000) return this.token;
    const body = new URLSearchParams({ username: this.username, password: this.password });
    const res = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`OpenF1 token request failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as TokenResponse;
    this.token = data.access_token ?? null;
    this.tokenExp = Date.now() + Number(data.expires_in || 3600) * 1000;
    return this.token;
  }

  buildUrl(path: string, filters: Filter[] = []): string {
    return buildUrl(this.baseUrl, path, filters);
  }

  /** Queued. Resolves to rows, or an empty array when OpenF1 has none. */
  get<T = unknown>(path: string, filters: Filter[] = []): Promise<T[]> {
    const run = this.chain.then(() => this.request<T>(path, filters));
    // Swallow on the chain only: the caller still sees the rejection.
    this.chain = run.catch(() => {});
    return run;
  }

  private async request<T>(path: string, filters: Filter[], attempt = 0): Promise<T[]> {
    const wait = this.lastStart + this.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastStart = Date.now();
    this.stats.requests++;

    const url = this.buildUrl(path, filters);
    const headers: Record<string, string> = { accept: 'application/json' };
    // A token failure must not take the request down: fall through unauthenticated
    // and let a 401 decide whether this is locked or a real problem.
    const token = await this.getToken().catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      return null;
    });
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      this.stats.errors++;
      if (attempt < 2) {
        await sleep(2000);
        return this.request<T>(path, filters, attempt + 1);
      }
      throw e;
    }
    this.stats.last = `${res.status} ${path}`;

    // OpenF1 answers "no results" with 404, so it is an empty page, not an error.
    if (res.status === 404) return [];

    if (res.status === 429 && attempt < 3) {
      this.stats.errors++;
      await sleep(5000 * (attempt + 1));
      return this.request<T>(path, filters, attempt + 1);
    }

    if (res.status === 401 || res.status === 403) {
      this.stats.errors++;
      // One retry on a fresh token, in case ours expired mid-session.
      if (token && attempt === 0) {
        await this.getToken(true).catch(() => {});
        return this.request<T>(path, filters, attempt + 1);
      }
      throw new LockedError(
        this.hasCredentials
          ? 'OpenF1 rejected the credentials for live data.'
          : 'This session is inside the live window, which needs OpenF1 sponsor credentials.',
      );
    }

    if (!res.ok) {
      this.stats.errors++;
      if (res.status >= 500 && attempt < 2) {
        await sleep(3000);
        return this.request<T>(path, filters, attempt + 1);
      }
      throw new Error(`OpenF1 ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    }

    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as T[]) : [];
  }
}

export { LockedError } from './errors.js';
export type { Filter, FilterOp } from './url.js';
