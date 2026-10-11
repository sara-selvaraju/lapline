// Formatting for the tower and the telemetry panel.
//
// Ported from reference/prototype/public/app.js.

export const TYRE_LETTER: Record<string, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
};

/** Australian English, short weekday and time: 'Sat, 9:30 pm'. */
export function fmtWhen(isoStr: string): string {
  return new Date(isoStr).toLocaleString('en-AU', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** A lap time as m:ss.mmm, or an en dash when there is none. */
export function fmtLap(s: number | null | undefined): string {
  if (s == null) return '–';
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, '0')}`;
}

/**
 * A gap. The leader shows 'Leader'; upstream text such as '+1 LAP' passes
 * through untouched, because it is not a number we can format.
 */
export function fmtGap(v: number | string | null | undefined, p: number | null | undefined): string {
  if (p === 1) return 'Leader';
  if (v == null) return '–';
  if (typeof v === 'string') return v;
  return `+${v.toFixed(3)}`;
}

/** Upstream text is escaped, never trusted as markup. */
export function esc(s: unknown): string {
  return String(s).replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string,
  );
}

export function tyreHtml(c: string | null | undefined, age: number | null | undefined): string {
  if (!c) return '<span class="tyre">?</span>';
  const letter = TYRE_LETTER[c] || c[0];
  return `<span class="tyre ${esc(c)}" title="${esc(c.toLowerCase())}">${esc(letter)}</span>${
    age != null ? `<span>${esc(age)}</span>` : ''
  }`;
}
