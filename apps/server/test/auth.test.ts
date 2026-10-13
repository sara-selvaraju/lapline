// The password gate, now a signed cookie rather than basic auth.
//
// docs/BUILD-PLAN.md M7: "The password survives the iOS home-screen app
// relaunching." That is what the cookie is for, and these cover the half of
// it that can be tested here: that a cookie we minted is accepted long after
// it was made, and that one we did not mint never is.

import { describe, expect, it } from 'vitest';
import {
  Attempts,
  authorised,
  cookieValid,
  COOKIE_MAX_AGE_S,
  loginPage,
  MAX_ATTEMPTS,
  mintCookie,
  readCookie,
  setCookieHeader,
  signingKey,
} from '../src/http/auth.js';

const KEY = 'a-long-random-secret';
const T = 1_760_000_000_000;

describe('the gate', () => {
  it('is open when no password is configured', () => {
    expect(authorised(undefined, '', KEY)).toBe(true);
    expect(authorised('nonsense', '', KEY)).toBe(true);
  });

  it('refuses a request with no cookie', () => {
    expect(authorised(undefined, 'secret', KEY)).toBe(false);
    expect(authorised('', 'secret', KEY)).toBe(false);
  });

  // These two go through `authorised`, which reads the real clock, so the
  // cookie is minted now rather than at the fixture time the rest use.
  it('accepts a cookie it minted', () => {
    expect(authorised(`lapline=${mintCookie(KEY)}`, 'secret', KEY)).toBe(true);
  });

  it('ignores the browser’s other cookies', () => {
    const header = `other=1; lapline=${mintCookie(KEY)}; another=2`;
    expect(authorised(header, 'secret', KEY)).toBe(true);
  });
});

describe('the cookie itself', () => {
  it('lasts six months, so a phone is not asked again every week', () => {
    expect(COOKIE_MAX_AGE_S).toBe(180 * 24 * 60 * 60);
    const cookie = mintCookie(KEY, T);
    // Still good the day before it runs out, and not the day after.
    expect(cookieValid(cookie, KEY, T + (COOKIE_MAX_AGE_S - 86_400) * 1000)).toBe(true);
    expect(cookieValid(cookie, KEY, T + (COOKIE_MAX_AGE_S + 86_400) * 1000)).toBe(false);
  });

  it('is refused once it has expired', () => {
    const cookie = mintCookie(KEY, T, 60);
    expect(cookieValid(cookie, KEY, T + 30_000)).toBe(true);
    expect(cookieValid(cookie, KEY, T + 61_000)).toBe(false);
  });

  it('is refused when signed with another key, which is how a password change revokes', () => {
    expect(cookieValid(mintCookie('old-secret', T), 'new-secret', T)).toBe(false);
  });

  it('is refused when the expiry has been edited, because the expiry is signed', () => {
    const cookie = mintCookie(KEY, T, 60);
    const forged = `${T + 999_999_999}.${cookie.split('.')[1]}`;
    expect(cookieValid(forged, KEY, T + 1000)).toBe(false);
  });

  it('is refused when the signature has been edited', () => {
    const cookie = mintCookie(KEY, T);
    const [expires] = cookie.split('.');
    expect(cookieValid(`${expires}.not-a-signature`, KEY, T)).toBe(false);
  });

  it('is refused when it is not the right shape at all', () => {
    for (const bad of ['', 'nodot', '.', '.sig', `${T}.`]) {
      expect({ bad, ok: cookieValid(bad, KEY, T) }).toEqual({ bad, ok: false });
    }
  });

  it('is HttpOnly and SameSite, and Secure only where that works', () => {
    const over = setCookieHeader('x', true);
    expect(over).toContain('HttpOnly');
    expect(over).toContain('SameSite=Lax');
    expect(over).toContain('Secure');
    expect(over).toContain(`Max-Age=${COOKIE_MAX_AGE_S}`);
    // Locally the server is plain http, where Secure would make it unusable.
    expect(setCookieHeader('x', false)).not.toContain('Secure');
  });
});

describe('readCookie', () => {
  it('finds the one it is asked for', () => {
    expect(readCookie('a=1; lapline=xyz; b=2')).toBe('xyz');
  });

  it('copes with spacing and with nothing at all', () => {
    expect(readCookie('lapline=xyz')).toBe('xyz');
    expect(readCookie('   lapline = xyz  ')).toBe('xyz');
    expect(readCookie(undefined)).toBeUndefined();
    expect(readCookie('a=1')).toBeUndefined();
  });

  it('does not mistake a cookie whose name merely ends the same way', () => {
    expect(readCookie('notlapline=xyz')).toBeUndefined();
  });
});

describe('signingKey', () => {
  it('uses SESSION_SECRET where it is set', () => {
    expect(signingKey('from-railway', 'pw')).toBe('from-railway');
  });

  it('falls back to the password, so a local run needs no second variable', () => {
    expect(signingKey('', 'pw')).toContain('pw');
  });

  it('changes when the password changes, which is what revokes every cookie', () => {
    const before = mintCookie(signingKey('', 'old-password'), T);
    expect(cookieValid(before, signingKey('', 'new-password'), T)).toBe(false);
  });
});

describe('attempt limiting', () => {
  it('lets an address try until it has had its share', () => {
    const a = new Attempts();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) a.wrong('1.2.3.4', T);
    expect(a.lockedFor('1.2.3.4', T)).toBeNull();
    a.wrong('1.2.3.4', T);
    expect(a.lockedFor('1.2.3.4', T)).toBeGreaterThan(0);
  });

  it('forgets an address once its lockout has passed', () => {
    const a = new Attempts();
    for (let i = 0; i < MAX_ATTEMPTS; i++) a.wrong('1.2.3.4', T);
    expect(a.lockedFor('1.2.3.4', T + 6 * 60_000)).toBeNull();
  });

  it('counts each address separately', () => {
    const a = new Attempts();
    for (let i = 0; i < MAX_ATTEMPTS; i++) a.wrong('1.2.3.4', T);
    expect(a.lockedFor('5.6.7.8', T)).toBeNull();
  });

  it('clears the count the moment someone gets it right', () => {
    const a = new Attempts();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) a.wrong('1.2.3.4', T);
    a.right('1.2.3.4');
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) a.wrong('1.2.3.4', T);
    expect(a.lockedFor('1.2.3.4', T)).toBeNull();
  });
});

describe('the sign-in page', () => {
  it('posts a password back to itself', () => {
    const html = loginPage();
    expect(html).toContain('action="/login"');
    expect(html).toContain('type="password"');
    expect(html).toContain('name="password"');
  });

  it('carries no stylesheet or script of its own, because both are behind the gate', () => {
    const html = loginPage();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('rel="stylesheet"');
  });

  it('shows a message when there is one, without letting it carry markup', () => {
    expect(loginPage('That password was not right.')).toContain('That password was not right.');
    expect(loginPage('<img src=x onerror=alert(1)>')).not.toContain('<img');
  });
});
