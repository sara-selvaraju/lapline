// Lapline: one Node process that talks to OpenF1 and streams frames to browsers
// over SSE. Ported from reference/prototype/server.js.

import { readEnv } from './env.js';
import { Feed } from './feed/feed.js';
import { OpenF1 } from './openf1/client.js';
import { createServer } from './http/server.js';

// Nobody is watching the logs on a race night, so say what happened and make
// the right choice without help.
//
// A stray rejection — a background fetch, an MQTT restart that lost its catch —
// is not a reason to drop everyone's stream, and under Node 22 an unhandled one
// ends the process. So log it and carry on. An uncaught exception is different:
// state may be inconsistent, and `railway.json` sets ON_FAILURE with ten
// retries, so exiting gets a clean process back in about twenty seconds.
//
// Only the message is logged. A thrown OpenF1 error can carry a URL, and
// nothing containing a credential goes to the log.
process.on('unhandledRejection', (e: unknown) => {
  console.error('unhandled rejection:', e instanceof Error ? e.message : String(e));
});
process.on('uncaughtException', (e: unknown) => {
  console.error('uncaught exception, exiting for a restart:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

const env = readEnv();

const api = new OpenF1({
  username: env.openf1Username,
  password: env.openf1Password,
  baseUrl: env.openf1Base,
});
const feed = new Feed(api, { liveDelayS: env.liveDelayS, liveTransport: env.liveTransport });

const server = createServer({
  feed,
  appPassword: env.appPassword,
  sessionSecret: env.sessionSecret,
  publicDir: env.publicDir,
});

server.listen(env.port, () => {
  console.log(`Lapline on :${env.port} (OpenF1 ${api.hasCredentials ? 'sponsor' : 'free'} tier)`);
  void feed.boot(env.sessionKey);
});
