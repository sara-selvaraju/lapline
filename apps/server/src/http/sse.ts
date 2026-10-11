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
  feed.addListener(res);
  onClose(() => feed.removeListener(res));
}
