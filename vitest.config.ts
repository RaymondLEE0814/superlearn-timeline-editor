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
      exclude: [
        'src/engine/**/*.test.ts',
        'src/engine/types.ts',
        // 로직 없이 재export 만 하는 배럴과 타입 전용 파일은 대상이 아니다.
        'src/engine/metadata/index.ts',
        'src/engine/playback/index.ts',
        'src/engine/render/index.ts',
        'src/engine/timeline/index.ts',
        'src/engine/api/services.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
