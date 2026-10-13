// The tokens are the design contract: docs/DESIGN.md says use these, not new
// colours or sizes. These tests read the stylesheet so a drift from the spec
// fails here rather than being spotted in a screenshot.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url)), 'utf8');
const fonts = readFileSync(fileURLToPath(new URL('../src/styles/fonts.css', import.meta.url)), 'utf8');
const index = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

const token = (name: string): string | null => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  return m ? m[1]!.trim() : null;
};

describe('colour tokens match docs/DESIGN.md', () => {
  const expected: Record<string, string> = {
    night: '#0e1626',
    panel: '#15213a',
    line: '#283857',
    'line-strong': '#3a4d74',
    flood: '#f2ebdd',
    'text-2': '#c9d1de',
    haze: '#8c9ab5',
    green: '#2bb673',
    yellow: '#f5b700',
    red: '#e5383b',
    // RedFlag.dc.html sets the band's text in white rather than flood.
    white: '#ffffff',
    purple: '#b794ff',
    pb: '#4cd08e',
    'tyre-soft': '#ff4d4f',
    'tyre-medium': '#ffd12e',
    'tyre-hard': '#f2ebdd',
    'tyre-inter': '#3cc35a',
    'tyre-wet': '#2e8bff',
  };

  for (const [name, hex] of Object.entries(expected)) {
    it(`--${name} is ${hex}`, () => {
      expect(token(name)).toBe(hex);
    });
  }

  it('carries no colour the spec does not list', () => {
    // Any hex in the token block must be one of the above.
    const hexes = [...css.matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]);
    const allowed = new Set(Object.values(expected));
    expect([...new Set(hexes)].filter((h) => !allowed.has(h))).toEqual([]);
  });
});

describe('portrait layout tokens match the artboard', () => {
  const expected: Record<string, string> = {
    'h-flag': '4px',
    'h-flag-label': '28px',
    'h-header': '56px',
    'h-track': '290px',
    'h-strip': '88px',
    'h-tower-head': '30px',
    'h-tower-row': '36px',
    'h-controls': '68px',
    // Replay.dc.html stacks a scrubber row above the transport row.
    'h-controls-replay': '90px',
    gutter: '16px',
    tap: '44px',
  };

  for (const [name, value] of Object.entries(expected)) {
    it(`--${name} is ${value}`, () => {
      expect(token(name)).toBe(value);
    });
  }

  it('leaves about nine tower rows at 390 x 844, as the milestone requires', () => {
    const px = (n: string): number => Number(token(n)!.replace('px', ''));
    const tower = 844 - px('h-flag') - px('h-header') - px('h-track') - px('h-strip') - px('h-controls');
    const rows = (tower - px('h-tower-head')) / px('h-tower-row');
    expect(rows).toBeGreaterThan(8);
    expect(rows).toBeLessThan(9.5);
  });
});

describe('type scale', () => {
  it('covers every size in the spec table', () => {
    const sizes = ['60px', '44px', '36px', '24px', '21px', '18px', '17px', '16px', '15px', '14px', '13px', '12px', '10px'];
    for (const s of sizes) expect(css).toContain(s);
  });

  it('covers the glance sizes, which read from across a room', () => {
    // Glance.dc.html has always used these; the spec's table caught up at M8.
    for (const s of ['40px', '34px', '30px', '26px', '22px']) expect(css).toContain(s);
  });
});

describe('the font is self-hosted', () => {
  it('declares all four weights the spec names', () => {
    for (const w of [400, 500, 600, 700]) {
      expect(fonts).toContain(`font-weight: ${w};`);
      expect(fonts).toContain(`/fonts/barlow-semi-condensed-${w}.woff2`);
    }
  });

  it('loads nothing from a third party', () => {
    expect(fonts).not.toContain('fonts.googleapis.com');
    expect(fonts).not.toContain('fonts.gstatic.com');
    expect(index).not.toContain('fonts.googleapis.com');
    expect(index).not.toContain('fonts.gstatic.com');
  });

  it('swaps rather than blocking paint while the face loads', () => {
    expect(fonts.match(/font-display: swap;/g)).toHaveLength(4);
  });
});

describe('motion', () => {
  it('animates only the flag band, and not at all under reduced motion', () => {
    expect(token('flag-transition')).toBe('240ms');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });
});

describe('landscape layout tokens match LiveLandscape.dc.html', () => {
  const landscape = (name: string): string | null => {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
    return m ? m[1]!.trim() : null;
  };

  it('puts the track at 470px and the strip at 74', () => {
    expect(landscape('w-track-landscape')).toBe('470px');
    expect(landscape('h-strip-landscape')).toBe('74px');
  });

  it('turns the layout over only when a window is wider than tall', () => {
    // Agreed in planning: a laptop gets it too, so there is no height bound.
    const style = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');
    expect(style.replace(/\s+/g, ' ')).toContain('@media (orientation: landscape)');
    expect(style).not.toMatch(/orientation: landscape\)\s*and\s*\(max-height/);
  });

  it('leaves about seven tower rows at 844 x 390', () => {
    const px = (n: string): number => Number((landscape(n) ?? '0').replace('px', ''));
    // Band, then the pill row, then the strip; the tower takes the rest.
    const rows = (390 - px('h-flag') - 46 - px('h-strip-landscape')) / px('h-tower-row');
    expect(rows).toBeGreaterThan(6.5);
    expect(rows).toBeLessThan(8);
  });
});
