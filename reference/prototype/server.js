// Lapline: one Node process that talks to OpenF1 and streams frames to browsers over SSE.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OpenF1 } = require('./lib/openf1');
const { Feed } = require('./lib/feed');

const PORT = Number(process.env.PORT) || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const PUBLIC = path.join(__dirname, 'public');

const api = new OpenF1({ username: process.env.OPENF1_USERNAME, password: process.env.OPENF1_PASSWORD });
const feed = new Feed(api, {
  liveDelayS: process.env.LIVE_DELAY_S,
  liveTransport: (process.env.LIVE_TRANSPORT || 'mqtt').toLowerCase(),
});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function authorised(req) {
  if (!APP_PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [, pass = ''] = Buffer.from(h.slice(6), 'base64').toString().split(/:(.*)/s);
  return safeEqual(pass, APP_PASSWORD);
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function control(body) {
  if (body.session) {
    feed.selectSession(body.session, { manual: true, mode: body.mode }).catch((e) => feed.setStatus('error', e.message));
    return { ok: true };
  }
  if (body.follow === 'auto') {
    feed.userPicked = false;
    const s = feed.pickAutoSession();
    if (s) feed.selectSession(s.session_key, { manual: false }).catch((e) => feed.setStatus('error', e.message));
    return { ok: true };
  }
  if (feed.mode === 'replay') {
    const p = {};
    if (typeof body.playing === 'boolean') p.playing = body.playing;
    if (typeof body.speed === 'number') p.speed = body.speed;
    if (typeof body.at === 'number') p.at = body.at;
    feed.setReplay(p);
  }
  if (feed.mode === 'live' && typeof body.delayS === 'number') {
    feed.liveDelayMs = Math.min(Math.max(body.delayS, 3), 180) * 1000;
    feed.broadcastStatus();
  }
  return { ok: true };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/healthz') return json(res, 200, { ok: true, mode: feed.mode });

  if (!authorised(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Lapline", charset="UTF-8"' });
    return res.end('Password required');
  }

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    feed.addListener(res);
    req.on('close', () => feed.removeListener(res));
    return;
  }

  if (url.pathname === '/api/control' && req.method === 'POST') {
    try {
      return json(res, 200, await control(await readBody(req)));
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/state') return json(res, 200, feed.initPayload());

  // Static files
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Lapline on :${PORT} (OpenF1 ${api.hasCredentials ? 'sponsor' : 'free'} tier)`);
  feed.boot(process.env.SESSION_KEY || 'auto');
});
