import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    ...(process.env.ORG_BROWSER_ONLY === 'true' ? { include: ['test/org-browser.test.ts'] } : {}),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/bootstrap.ts'],
    },
  },
});
