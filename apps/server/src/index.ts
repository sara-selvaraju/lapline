// Lapline: one Node process that talks to OpenF1 and streams frames to browsers
// over SSE. Ported from reference/prototype/server.js.

import { readEnv } from './env.js';
import { Feed } from './feed/feed.js';
import { OpenF1 } from './openf1/client.js';
import { createServer } from './http/server.js';

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
