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
/**
 * The gap to the car behind, unsigned.
 *
 * DriverDetail.dc.html writes the car ahead as "+0.812" and the car behind as
 * "0.684". The sign says which way the gap runs, and for the car behind the
 * label has already said it.
 */
export function fmtBehind(v: number | string | null): string {
  if (v == null) return '–';
  if (typeof v === 'string') return v;
  return Math.abs(v).toFixed(3);
}

/**
 * A race duration as h:mm:ss.mmm, which is how the winner's total reads.
 * Lap times use `fmtLap`; this is for the hour-long figure beside it.
 */
export function fmtClock(seconds: number | null): string {
  if (seconds == null) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = s.toFixed(3).padStart(6, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Race control shouts in capitals; docs/DESIGN.md asks for sentence case.
 *
 * Only the shape is changed, never the words: driver codes and car numbers
 * stay as they came, so "CAR 18 (ORI)" keeps its meaning.
 */
export function sentenceCase(msg: string): string {
  const lower = msg.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Elapsed time as h:mm:ss, for the replay transport. */
export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * When a locked session becomes free, as a weekday and a local time.
 *
 * docs/BUILD-PLAN.md M7 asks for "the correct local time for free replay", so
 * it is deliberately the viewer's own clock and their own weekday — the
 * server sends an instant and the phone decides what that means where it is.
 */
export function fmtFreeAt(iso: string | undefined): string {
  if (!iso) return 'later today';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'later today';
  return at.toLocaleString('en-AU', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
}

/** The compound's colour token, or haze when upstream sent something odd. */
export function tyreVar(compound: string | null): string {
  const key = (compound ?? '').toLowerCase();
  if (key === 'intermediate') return 'var(--tyre-inter)';
  if (key === 'soft' || key === 'medium' || key === 'hard' || key === 'wet') return `var(--tyre-${key})`;
  return 'var(--haze)';
}

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
