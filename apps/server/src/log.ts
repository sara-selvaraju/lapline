// The server's log: one JSON object per line on stdout.
//
// Railway reads `message` as the line's text and `level` as its severity, and
// keeps every other field as an attribute its log search can filter on, so
// `@event:summary` or `@level:error` finds what matters after a race. Anywhere
// else it is still one readable line per event.
//
// What never goes in: credentials, request URLs, IP addresses, and the fields
// of a thrown error, which can carry a URL. `errText` keeps only the message.

export type Level = 'info' | 'warn' | 'error';
export type Fields = Record<string, unknown>;

type Writer = (line: string) => void;

const stdout: Writer = (line) => {
  process.stdout.write(`${line}\n`);
};
let writer: Writer = stdout;

/** For tests: capture lines instead of printing them. Pass null to restore stdout. */
export function setLogWriter(w: Writer | null): void {
  writer = w ?? stdout;
}

/** The message of anything thrown, and nothing else from it. */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One log line. `level` and `message` cannot be overridden by a field. */
export function formatLine(level: Level, message: string, fields: Fields = {}): string {
  const { level: _l, message: _m, ...rest } = fields;
  try {
    return JSON.stringify({ level, message, ...rest });
  } catch {
    // A field that will not serialise (a cycle, a BigInt) costs the fields,
    // never the line.
    return JSON.stringify({ level, message, unserialisable: true });
  }
}

function emit(level: Level, message: string, fields?: Fields): void {
  writer(formatLine(level, message, fields));
}

export const log = {
  info: (message: string, fields?: Fields): void => emit('info', message, fields),
  warn: (message: string, fields?: Fields): void => emit('warn', message, fields),
  error: (message: string, fields?: Fields): void => emit('error', message, fields),
};
