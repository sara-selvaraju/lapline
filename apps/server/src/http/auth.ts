// The password gate: a page that sets a signed cookie.
//
// docs/ARCHITECTURE.md chose this over basic auth because basic-auth prompts
// are unreliable in iOS home-screen web apps — the browser forgets them when
// a standalone app relaunches, which is exactly how this gets used. A cookie
// with a long life survives that.
//
// /healthz stays outside the gate so Railway can reach it, and /login has to
// be outside it too, or there would be no way in.

import crypto from 'node:crypto';

/** Six months: type the password about once a season. */
export const COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;
export const COOKIE_NAME = 'lapline';

/** A wrong answer costs this long, which is free to us and tedious to a guesser. */
export const WRONG_DELAY_MS = 500;
/** Wrong answers from one address before it is refused for a while. */
export const MAX_ATTEMPTS = 10;
export const LOCKOUT_MS = 5 * 60_000;

/** Constant-time once the lengths match; an unequal length is not a secret. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * The key the cookie is signed with.
 *
 * `SESSION_SECRET` where it is set, which is what docs/ARCHITECTURE.md
 * specifies and what Railway holds. Where it is not — a local run, a test —
 * it is derived from the password instead, so the gate still works without a
 * second variable to remember. Either way, changing the password invalidates
 * every cookie, which is the revoke story.
 */
export function signingKey(sessionSecret: string, appPassword: string): string {
  return sessionSecret || `derived:${appPassword}`;
}

/** `<expires>.<signature>`, where the signature covers the expiry. */
export function mintCookie(key: string, now = Date.now(), maxAgeS = COOKIE_MAX_AGE_S): string {
  const expires = now + maxAgeS * 1000;
  return `${expires}.${sign(key, String(expires))}`;
}

function sign(key: string, value: string): string {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

/**
 * Whether a cookie is one we minted and has not expired.
 *
 * The signature is checked before the expiry is trusted, because the expiry
 * is part of what is signed: an unsigned cookie could otherwise claim any
 * date it liked.
 */
export function cookieValid(value: string | undefined, key: string, now = Date.now()): boolean {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const expires = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!safeEqual(mac, sign(key, expires))) return false;
  const at = Number(expires);
  return Number.isFinite(at) && at > now;
}

/** The one cookie we care about, out of whatever else the browser sends. */
export function readCookie(header: string | undefined, name = COOKIE_NAME): string | undefined {
  for (const part of (header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function setCookieHeader(value: string, secure: boolean): string {
  const bits = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE_S}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  // Secure would make the cookie unusable over plain http, which is how it is
  // run locally, so it follows the connection rather than being hard-coded.
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/** True when the request may proceed. With no password configured, the site is open. */
export function authorised(cookieHeader: string | undefined, appPassword: string, key: string): boolean {
  if (!appPassword) return true;
  return cookieValid(readCookie(cookieHeader), key);
}

/**
 * How many wrong answers each address has to its name.
 *
 * In memory, so a restart forgives everyone. That is the right trade for a
 * personal site: the cap exists to make guessing pointless, not to be a
 * durable security boundary.
 */
export class Attempts {
  private readonly tries = new Map<string, { count: number; until: number }>();

  /** Null when the address may try, or the milliseconds left when it may not. */
  lockedFor(address: string, now = Date.now()): number | null {
    const row = this.tries.get(address);
    if (!row || row.count < MAX_ATTEMPTS) return null;
    if (now >= row.until) {
      this.tries.delete(address);
      return null;
    }
    return row.until - now;
  }

  wrong(address: string, now = Date.now()): void {
    const row = this.tries.get(address) ?? { count: 0, until: 0 };
    row.count++;
    row.until = now + LOCKOUT_MS;
    this.tries.set(address, row);
  }

  right(address: string): void {
    this.tries.delete(address);
  }
}

/**
 * The form body as text.
 *
 * Separate from control.ts's `readBody`, which parses JSON: the sign-in form
 * posts url-encoded, and a password is the one thing that must not fail to
 * read because it was the wrong shape. Capped, since it arrives before any
 * password has been checked.
 */
export function readForm(req: {
  on(event: string, fn: (chunk?: unknown) => void): unknown;
}): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += String(c);
      if (data.length > 4096) {
        data = '';
        resolve('');
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

/** The sign-in page. Self-contained, because every static file is behind the gate. */
export function loginPage(message = ''): string {
  const note = message
    ? `<p class="note" role="alert">${message.replace(/[<>&]/g, '')}</p>`
    : '';
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0E1626">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Lapline</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    background: #0E1626; color: #F2EBDD; padding: 24px;
    font: 400 18px/1.4 system-ui, -apple-system, sans-serif;
  }
  form { width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 14px; }
  h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 0.01em; }
  p { margin: 0; color: #8C9AB5; font-size: 16px; }
  .note { color: #F5B700; }
  input {
    height: 52px; padding: 0 14px; border-radius: 12px; font-size: 18px;
    border: 1px solid #283857; background: #15213A; color: #F2EBDD;
  }
  button {
    height: 52px; border: 0; border-radius: 12px; font: inherit; font-weight: 600;
    background: #F2EBDD; color: #0E1626;
  }
</style>
</head>
<body>
<form method="post" action="/login">
  <h1>Lapline</h1>
  <p>A second screen for race weekends. Enter the password to continue.</p>
  ${note}
  <input type="password" name="password" autocomplete="current-password"
         aria-label="Password" autofocus required>
  <button type="submit">Continue</button>
</form>
</body>
</html>`;
}

export { safeEqual };
