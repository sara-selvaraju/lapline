// Every environment variable the server reads, in one place.
//
// Nothing here is logged or sent to a browser. AGENTS.md: never commit or log
// secrets, and never echo env values in /api/state or errors.

import path from 'node:path';
import { normaliseBase } from './openf1/url.js';

export interface Env {
  port: number;
  appPassword: string;
  /** Signs the session cookie. Falls back to the password when unset. */
  sessionSecret: string;
  openf1Username: string | undefined;
  openf1Password: string | undefined;
  openf1Base: string | undefined;
  liveTransport: string;
  liveDelayS: string | undefined;
  sessionKey: string;
  publicDir: string;
}

/** apps/server/dist/src/ to apps/web/dist/, which is what npm run build produces. */
function defaultPublicDir(): string {
  return path.resolve(import.meta.dirname, '../../../web/dist');
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  return {
    port: Number(e.PORT) || 3000,
    appPassword: e.APP_PASSWORD || '',
    sessionSecret: e.SESSION_SECRET || '',
    openf1Username: e.OPENF1_USERNAME,
    openf1Password: e.OPENF1_PASSWORD,
    openf1Base: e.OPENF1_BASE,
    liveTransport: (e.LIVE_TRANSPORT || 'mqtt').toLowerCase(),
    liveDelayS: e.LIVE_DELAY_S,
    sessionKey: e.SESSION_KEY || 'auto',
    publicDir: e.PUBLIC_DIR || defaultPublicDir(),
  };
}

/**
 * A warning when the app has no password and is showing real OpenF1 data, or
 * null when there is nothing to say.
 *
 * An empty APP_PASSWORD turns the gate off, which is right on your own machine
 * and wrong on a public URL: anyone who finds it can watch, change the session
 * for every viewer, and see live data that OpenF1 sells to its sponsors. So it
 * stays a choice, but not a silent one. Against the mock it says nothing,
 * because that is every development run.
 */
export function openGateWarning(env: Pick<Env, 'appPassword' | 'openf1Base'>): string | null {
  if (env.appPassword) return null;
  const host = new URL(normaliseBase(env.openf1Base)).hostname;
  if (host === 'localhost' || host === '127.0.0.1') return null;
  return (
    'No APP_PASSWORD is set, so anyone who can reach this server can use it. ' +
    'Fine on your own machine; set APP_PASSWORD before deploying it anywhere public.'
  );
}
