import { describe, expect, it } from 'vitest';
import { cmp, matches, parseFilters } from '../src/filters.js';

describe('parseFilters', () => {
  it('reads a bare equals', () => {
    expect(parseFilters('year=2026')).toEqual([['year', '=', '2026']]);
  });

  it('reads percent-encoded comparison operators', () => {
    expect(parseFilters('date%3E=2026-10-11T00%3A00%3A00.000Z')).toEqual([
      ['date', '>=', '2026-10-11T00:00:00.000Z'],
    ]);
    expect(parseFilters('date%3C2026-10-11T00%3A00%3A30.000Z')).toEqual([
      ['date', '<', '2026-10-11T00:00:30.000Z'],
    ]);
  });

  it('reads a repeated field as two filters, which is how ranges arrive', () => {
    const f = parseFilters('session_key=1002&date%3E=2026-01-01T00%3A00%3A00.000Z&date%3C2026-01-02T00%3A00%3A00.000Z');
    expect(f).toHaveLength(3);
    expect(f[1]![1]).toBe('>=');
    expect(f[2]![1]).toBe('<');
  });

  it('ignores an empty query string and unparseable parts', () => {
    expect(parseFilters('')).toEqual([]);
    expect(parseFilters('&&')).toEqual([]);
    expect(parseFilters('nonsense')).toEqual([]);
  });

  it('decodes a plus as a space, so a date never arrives mangled', () => {
    expect(parseFilters('message=SAFETY+CAR')).toEqual([['message', '=', 'SAFETY CAR']]);
  });
});

describe('cmp', () => {
  it('compares with each operator', () => {
    expect(cmp(5, '=', 5)).toBe(true);
    expect(cmp(5, '=', 6)).toBe(false);
    expect(cmp(6, '>', 5)).toBe(true);
    expect(cmp(5, '>=', 5)).toBe(true);
    expect(cmp(4, '<', 5)).toBe(true);
    expect(cmp(5, '<=', 5)).toBe(true);
  });
});

describe('matches', () => {
  it('keeps a row that has no such field, so unrelated filters never exclude it', () => {
    expect(matches({ driver_number: 44 }, ['session_key', '=', '1002'])).toBe(true);
  });

  it('compares numbers numerically, not as strings', () => {
    expect(matches({ session_key: 1002 }, ['session_key', '=', '1002'])).toBe(true);
    // String comparison would make '9' > '1002'.
    expect(matches({ lap_number: 9 }, ['lap_number', '>', '1002'])).toBe(false);
  });

  it('compares dates as instants, so +00:00 and Z are equivalent', () => {
    const row = { date: '2026-10-11T00:00:10.000+00:00' };
    expect(matches(row, ['date', '>=', '2026-10-11T00:00:00.000Z'])).toBe(true);
    expect(matches(row, ['date', '<', '2026-10-11T00:00:05.000Z'])).toBe(false);
  });

  it('compares booleans as their string form', () => {
    expect(matches({ is_cancelled: false }, ['is_cancelled', '=', 'false'])).toBe(true);
    expect(matches({ is_cancelled: false }, ['is_cancelled', '=', 'true'])).toBe(false);
  });

  it('falls back to string comparison for everything else', () => {
    expect(matches({ session_name: 'Sprint' }, ['session_name', '=', 'Sprint'])).toBe(true);
  });
});
