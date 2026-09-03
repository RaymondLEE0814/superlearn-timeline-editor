import { defineConfig, devices } from '@playwright/test';

// 4173 은 이 PC 의 다른 프로젝트 개발 서버가 쓰고 있어 충돌한다.
const PORT = 4319;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // npm 을 거치면 Windows 에서 인자 전달이 어긋나므로 vite 를 직접 부른다.
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    // 남의 서버에 붙으면 엉뚱한 앱을 테스트하게 되므로 항상 새로 띄운다.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
