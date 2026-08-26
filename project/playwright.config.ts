import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 15 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  webServer: {
    command: 'npm run dev:full',
    port: 5173,
    timeout: 120000,
    reuseExistingServer: process.env.CI ? false : true,
  },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Emulate dark color scheme for all tests
    colorScheme: 'dark',
    launchOptions: {
      args: ['--start-maximized'], // Add start-maximized argument
    },
    headless: false,
    viewport: { width: 1280, height: 960 }, // Set a specific, reasonable size
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
