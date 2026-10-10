import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Workspaces keep their tests beside their source, in test/.
    include: ['{apps,packages,tools}/*/test/**/*.test.ts'],
    environment: 'node',
    // The request queue and fetch scheduler use real timers in a few tests.
    testTimeout: 20_000,
  },
});
