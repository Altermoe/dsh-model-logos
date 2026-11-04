import { defineConfig } from 'vitest/config';

/**
 * Test configuration for the plugin toolchain.
 *
 * The suite covers three layers:
 *   1. pure modules (`src/match.ts`, `src/artwork.ts`, `src/resolve.ts`);
 *   2. the generated browser bundle, evaluated in a minimal fake DOM/React/settings
 *      stand-in (`test/client.test.ts`);
 *   3. the headless-Edge fixture harness, which lives in `scripts/verify-dom.ts`
 *      because it needs a real browser and is run through `pnpm run verify:dom`.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    reporters: process.env.CI === undefined ? ['default'] : ['default', 'junit'],
    outputFile: { junit: '.preview/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/client.ts', 'src/host.ts'],
      reporter: ['text', 'lcov'],
      reportsDirectory: '.preview/coverage',
    },
  },
});
