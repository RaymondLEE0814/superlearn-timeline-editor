import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/engine/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      exclude: ['src/engine/**/*.test.ts', 'src/engine/types.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
