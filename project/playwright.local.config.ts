import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  // NOTE: No webServer configured here — use existing dev server (set BASE_URL if needed).
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5174',
    trace: 'on',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});