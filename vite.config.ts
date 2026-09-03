import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // 비우는 일은 scripts/prebuild-clean.mjs 가 맡는다.
    // 이 PC 에서는 vite 가 직접 비우려 하면 프로세스가 죽는다(README 의 개발 환경 주의 참고).
    emptyOutDir: false,
  },
});
