// OpenF1 filter encoding.
//
// Filters work on any non-array field: `field=value`, or `field>value` and the
// other three comparisons, with the field repeated for a range. Browsers and
// fetch percent-encode < and >, and OpenF1 accepts the encoded form, so that is
// what we send. The encoded strings are a contract with the mock's own filter
// parser: tools/mock-openf1/test/filters.test.ts asserts it reads exactly what
// url.test.ts asserts this writes.

export type FilterOp = '=' | '>' | '>=' | '<' | '<=';

/** A single filter: field, operator, value. */
export type Filter = [field: string, op: FilterOp, value: string | number];

/** Trailing slashes would double up in the path, so they come off once here. */
export function normaliseBase(base: string | undefined): string {
  return (base || 'https://api.openf1.org').replace(/\/$/, '');
}

/**
 * The operator's `=` stays outside the escape, because only the comparison
 * character needs encoding: `>=` becomes `%3E=`, not `%3E%3D`.
 */
export function buildUrl(base: string, path: string, filters: Filter[] = []): string {
  const parts = filters.map(([k, op, v]) => {
    const enc = op === '=' ? '=' : encodeURIComponent(op.replace('=', '')) + (op.endsWith('=') ? '=' : '');
    return `${k}${enc}${encodeURIComponent(v)}`;
  });
  return `${base}/v1/${path}${parts.length ? '?' + parts.join('&') : ''}`;
}
