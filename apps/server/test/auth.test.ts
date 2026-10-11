import { describe, expect, it } from 'vitest';
import { authorised, CHALLENGE } from '../src/http/auth.js';

const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('authorised', () => {
  it('lets everything through when no password is configured', () => {
    expect(authorised(undefined, '')).toBe(true);
    expect(authorised(basic('a', 'b'), '')).toBe(true);
  });

  it('rejects a request with no Authorization header', () => {
    expect(authorised(undefined, 'secret')).toBe(false);
    expect(authorised('', 'secret')).toBe(false);
  });

  it('rejects a non-Basic scheme', () => {
    expect(authorised('Bearer secret', 'secret')).toBe(false);
  });

  it('accepts the right password with any username', () => {
    expect(authorised(basic('anyone', 'secret'), 'secret')).toBe(true);
    expect(authorised(basic('', 'secret'), 'secret')).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(authorised(basic('a', 'wrong'), 'secret')).toBe(false);
  });

  it('rejects a password that is a prefix of the real one', () => {
    expect(authorised(basic('a', 'sec'), 'secret')).toBe(false);
  });

  it('accepts a password containing a colon', () => {
    expect(authorised(basic('a', 'pass:word'), 'pass:word')).toBe(true);
  });

  it('rejects credentials with no colon at all', () => {
    expect(authorised(`Basic ${Buffer.from('nocolon').toString('base64')}`, 'secret')).toBe(false);
  });

  it('offers a Basic challenge for the browser to prompt on', () => {
    expect(CHALLENGE['WWW-Authenticate']).toContain('Basic realm="Lapline"');
  });
});
