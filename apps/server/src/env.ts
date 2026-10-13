// Every environment variable the server reads, in one place.
//
// Nothing here is logged or sent to a browser. AGENTS.md: never commit or log
// secrets, and never echo env values in /api/state or errors.

import path from 'node:path';

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
