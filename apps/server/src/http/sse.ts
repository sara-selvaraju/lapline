// The SSE stream.
//
// X-Accel-Buffering: no stops Railway's proxy holding frames back, and a ping
// every 15 s keeps the connection from being reaped. Browsers reconnect on their
// own, so there is no retry logic here beyond the retry hint.

import type { ServerResponse } from 'node:http';
import type { Feed } from '../feed/feed.js';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function openStream(res: ServerResponse, feed: Feed, onClose: (fn: () => void) => void): void {
  res.writeHead(200, SSE_HEADERS);
  res.write('retry: 3000\n\n');
  // A socket that fails between frames emits 'error' on the response, and an
  // unhandled 'error' on a stream ends the process. One phone losing its
  // connection on the way through a tunnel must not take the stream down for
  // everyone else, so handle it and let it go.
  res.on('error', () => feed.removeListener(res));
  feed.addListener(res);
  onClose(() => feed.removeListener(res));
}
