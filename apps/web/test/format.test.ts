import { describe, expect, it } from 'vitest';
import { esc, fmtGap, fmtLap, tyreHtml, TYRE_LETTER, fmtBehind, fmtFreeAt } from '../src/ui/format.js';

describe('fmtLap', () => {
  it('formats as m:ss.mmm with a padded seconds field', () => {
    expect(fmtLap(92.431)).toBe('1:32.431');
    expect(fmtLap(61.5)).toBe('1:01.500');
    expect(fmtLap(119.999)).toBe('1:59.999');
  });

  it('handles times over ten minutes and under one', () => {
    expect(fmtLap(605.25)).toBe('10:05.250');
    expect(fmtLap(9.1)).toBe('0:09.100');
  });

  it('shows an en dash when there is no time', () => {
    expect(fmtLap(null)).toBe('–');
    expect(fmtLap(undefined)).toBe('–');
  });
});

describe('fmtGap', () => {
  it('names the leader rather than showing a zero gap', () => {
    expect(fmtGap(null, 1)).toBe('Leader');
    expect(fmtGap(12.5, 1)).toBe('Leader');
  });

  it('prefixes a numeric gap with a plus and three decimals', () => {
    expect(fmtGap(1.2, 2)).toBe('+1.200');
    expect(fmtGap(0.089, 5)).toBe('+0.089');
  });

  it('passes upstream text through untouched', () => {
    expect(fmtGap('+1 LAP', 15)).toBe('+1 LAP');
  });

  it('shows an en dash when there is no gap yet', () => {
    expect(fmtGap(null, 7)).toBe('–');
    expect(fmtGap(undefined, null)).toBe('–');
  });
});

describe('esc', () => {
  it('escapes the characters that would change markup', () => {
    expect(esc('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(esc('Hamilton & Russell')).toBe('Hamilton &amp; Russell');
  });

  it('leaves ordinary race control text alone', () => {
    expect(esc('SAFETY CAR DEPLOYED')).toBe('SAFETY CAR DEPLOYED');
  });

  it('copes with a non-string', () => {
    expect(esc(44)).toBe('44');
    expect(esc(null)).toBe('null');
  });
});

describe('tyreHtml', () => {
  it('maps each compound to its letter', () => {
    for (const [compound, letter] of Object.entries(TYRE_LETTER)) {
      expect(tyreHtml(compound, 0)).toContain(`>${letter}<`);
    }
  });

  it('shows the age beside the letter', () => {
    expect(tyreHtml('HARD', 12)).toContain('<span>12</span>');
  });

  it('omits the age when there is none', () => {
    expect(tyreHtml('HARD', null)).not.toContain('<span>');
  });

  it('falls back to the first character of an unknown compound', () => {
    expect(tyreHtml('TEST', 1)).toContain('>T<');
  });

  it('shows a question mark when the compound is unknown', () => {
    expect(tyreHtml(null, null)).toBe('<span class="tyre">?</span>');
  });

  it('escapes a compound name rather than trusting it as markup', () => {
    expect(tyreHtml('<b>', 1)).not.toContain('<b>');
  });
});

describe('fmtBehind', () => {
  it('drops the sign, because the label already says which way', () => {
    expect(fmtBehind(0.684)).toBe('0.684');
  });

  it('always shows three decimals', () => {
    expect(fmtBehind(2)).toBe('2.000');
  });

  it('passes upstream text through', () => {
    expect(fmtBehind('+1 LAP')).toBe('+1 LAP');
  });

  it('shows a dash when there is nothing', () => {
    expect(fmtBehind(null)).toBe('–');
  });
});

describe('fmtFreeAt', () => {
  // docs/BUILD-PLAN.md M7: "The locked screen shows the correct local time for
  // free replay." The server sends an instant; the phone decides what that
  // means where it is.
  it('names the weekday and the local time', () => {
    const at = new Date('2026-10-12T01:30:00+11:00');
    const shown = fmtFreeAt(at.toISOString());
    // Whatever zone the test runs in, it must agree with the platform.
    const want = at.toLocaleString('en-AU', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
    expect(shown).toBe(want);
  });

  it('is a weekday, not a date', () => {
    expect(fmtFreeAt('2026-10-12T01:30:00Z')).toMatch(
      /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/,
    );
  });

  it('says something sensible when there is no time to show', () => {
    expect(fmtFreeAt(undefined)).toBe('later today');
    expect(fmtFreeAt('not a date')).toBe('later today');
  });
});
