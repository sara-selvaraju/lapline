import { describe, expect, it } from 'vitest';
import { buildUrl, normaliseBase } from '../src/openf1/url.js';

const BASE = 'https://api.openf1.org';

// These exact strings are the contract with the mock's filter parser.
// tools/mock-openf1/test/filters.test.ts asserts it reads what this writes.
describe('buildUrl', () => {
  it('encodes = as a bare equals', () => {
    expect(buildUrl(BASE, 'sessions', [['year', '=', 2026]])).toBe(`${BASE}/v1/sessions?year=2026`);
  });

  it('encodes > and < with no trailing equals', () => {
    expect(buildUrl(BASE, 'laps', [['lap_number', '>', 5]])).toBe(`${BASE}/v1/laps?lap_number%3E5`);
    expect(buildUrl(BASE, 'laps', [['lap_number', '<', 5]])).toBe(`${BASE}/v1/laps?lap_number%3C5`);
  });

  it('encodes >= and <= keeping the equals outside the escape', () => {
    // %3E= not %3E%3D: only the comparison character needs escaping.
    expect(buildUrl(BASE, 'laps', [['lap_number', '>=', 5]])).toBe(`${BASE}/v1/laps?lap_number%3E=5`);
    expect(buildUrl(BASE, 'laps', [['lap_number', '<=', 5]])).toBe(`${BASE}/v1/laps?lap_number%3C=5`);
  });

  it('percent-encodes colons in ISO values', () => {
    const url = buildUrl(BASE, 'location', [['date', '>=', '2026-10-11T00:00:00.000Z']]);
    expect(url).toBe(`${BASE}/v1/location?date%3E=2026-10-11T00%3A00%3A00.000Z`);
  });

  it('builds a window as the same field twice', () => {
    const url = buildUrl(BASE, 'location', [
      ['session_key', '=', 1002],
      ['date', '>=', '2026-10-11T00:00:00.000Z'],
      ['date', '<', '2026-10-11T00:00:30.000Z'],
    ]);
    expect(url).toBe(
      `${BASE}/v1/location?session_key=1002&date%3E=2026-10-11T00%3A00%3A00.000Z&date%3C2026-10-11T00%3A00%3A30.000Z`,
    );
  });

  it('omits the query string when there are no filters', () => {
    expect(buildUrl(BASE, 'sessions')).toBe(`${BASE}/v1/sessions`);
    expect(buildUrl(BASE, 'sessions', [])).toBe(`${BASE}/v1/sessions`);
  });
});

describe('normaliseBase', () => {
  it('strips a trailing slash', () => {
    expect(normaliseBase('http://localhost:4001/')).toBe('http://localhost:4001');
  });

  it('leaves a clean base alone', () => {
    expect(normaliseBase('http://localhost:4001')).toBe('http://localhost:4001');
  });

  it('falls back to the real API when unset', () => {
    expect(normaliseBase(undefined)).toBe('https://api.openf1.org');
    expect(normaliseBase('')).toBe('https://api.openf1.org');
  });
});
