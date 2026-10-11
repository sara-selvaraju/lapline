// The password gate.
//
// Basic auth, as the prototype has it. ARCHITECTURE.md's decision table calls for
// a password page setting a signed cookie, because basic-auth prompts are
// unreliable in iOS home-screen web apps — that arrives in M7. /healthz stays
// outside the gate either way.

import crypto from 'node:crypto';

/** Constant-time once the lengths match; an unequal length is not a secret. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * True when the request may proceed. Any username is accepted: the password is
 * the whole secret. With no password configured, the site is open.
 */
export function authorised(authHeader: string | undefined, appPassword: string): boolean {
  if (!appPassword) return true;
  const h = authHeader || '';
  if (!h.startsWith('Basic ')) return false;
  // Split on the first colon only, so a password containing one still works.
  const [, pass = ''] = Buffer.from(h.slice(6), 'base64').toString().split(/:(.*)/s);
  return safeEqual(pass, appPassword);
}

export const CHALLENGE = { 'WWW-Authenticate': 'Basic realm="Lapline", charset="UTF-8"' };
