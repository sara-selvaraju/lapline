// The two read-only queries. The browser never calls OpenF1 itself.

export interface FlagPeriod {
  flag: string;
  from: number;
  to: number | null;
}

export interface Crossings {
  t: number;
  lapMetres: number | null;
  crossings: number[];
  next: { n: number; at: number | null; metres: number | null } | null;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (e) {
    console.error(e);
    return null;
  }
}

export const fetchCrossings = (): Promise<Crossings | null> => get<Crossings>('/api/crossings');

export const fetchPeriods = (): Promise<{ periods: FlagPeriod[] } | null> =>
  get<{ periods: FlagPeriod[] }>('/api/periods');
