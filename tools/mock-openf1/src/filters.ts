// OpenF1's filter syntax, as the mock understands it.
//
// Filters arrive percent-encoded, because browsers and fetch escape < and >.
// Ported from reference/prototype/mock/mock-openf1.js.

export type Op = '=' | '>' | '>=' | '<' | '<=';
export type Filter = [field: string, op: Op, raw: string];

export function parseFilters(qs: string): Filter[] {
  const f: Filter[] = [];
  for (const part of qs.split('&').filter(Boolean)) {
    const dec = decodeURIComponent(part.replace(/\+/g, ' '));
    const m = dec.match(/^([a-z_0-9]+)(>=|<=|>|<|=)(.*)$/);
    if (m) f.push([m[1]!, m[2] as Op, m[3]!]);
  }
  return f;
}

export function cmp(a: number | string, op: Op, b: number | string): boolean {
  switch (op) {
    case '=':
      return a === b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
  }
  return false;
}

/** A row with no such field always matches, so unrelated filters never exclude it. */
export function matches(row: Record<string, unknown>, [k, op, raw]: Filter): boolean {
  const v = row[k];
  if (v === undefined) return true;
  if (typeof v === 'number') return cmp(v, op, Number(raw));
  if (typeof v === 'boolean') return cmp(String(v), op, raw);
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v) && !Number.isNaN(Date.parse(raw))) {
    return cmp(Date.parse(v), op, Date.parse(raw));
  }
  return cmp(String(v), op, raw);
}
