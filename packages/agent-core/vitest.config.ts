import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/skills/**/*.ts', 'src/provider.ts'],
      thresholds: {
        lines: 65,
        functions: 50,
        statements: 65,
        branches: 60,
      },
    },
  },
});
