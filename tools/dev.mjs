#!/usr/bin/env node
// `npm run dev`: the mock, the server and the web app together.
//
// One tsc build watches shared, server and mock through the solution file, so a
// change anywhere recompiles once. node --watch restarts the two runnables when
// their output changes, and Vite serves the UI, proxying /events and /api to the
// server. No runner dependency: a child per job, killed together on Ctrl-C.

import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const MOCK_PORT = process.env.MOCK_PORT ?? '4001';
const SERVER_PORT = process.env.PORT ?? '3000';

const COLOURS = { tsc: 36, mock: 35, server: 32, web: 34 };
const children = [];
let shuttingDown = false;

function prefix(name, line) {
  return `\x1b[${COLOURS[name] ?? 37}m${name.padEnd(6)}\x1b[0m ${line}`;
}

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) console.log(prefix(name, line));
    });
  }
  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(prefix(name, `exited with code ${code}`));
    // The watchers should never exit on their own; if one does, stop the lot
    // rather than leaving a half-running stack that looks fine.
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => {
    for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
    process.exit(code);
  }, 300);
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));

// Build once up front, so nothing starts against stale or missing output.
console.log(prefix('tsc', 'building shared, server and mock...'));
const first = spawnSync('npx', ['tsc', '-b', 'tsconfig.json'], { stdio: 'inherit' });
if (first.status !== 0) {
  console.error(prefix('tsc', 'initial build failed; fix the errors and rerun'));
  process.exit(first.status ?? 1);
}

run('tsc', 'npx', ['tsc', '-b', 'tsconfig.json', '--watch', '--preserveWatchOutput']);
run('mock', process.execPath, ['--watch', 'tools/mock-openf1/dist/src/index.js'], {
  MOCK_PORT,
});
run('server', process.execPath, ['--watch', 'apps/server/dist/src/index.js'], {
  PORT: SERVER_PORT,
  OPENF1_BASE: process.env.OPENF1_BASE ?? `http://localhost:${MOCK_PORT}`,
});
run('web', 'npm', ['run', 'dev', '-w', '@lapline/web']);

console.log(prefix('tsc', `mock :${MOCK_PORT}  server :${SERVER_PORT}  web :5173`));
