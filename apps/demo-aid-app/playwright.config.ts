import { defineConfig, devices } from "@playwright/test";

const port = 43173;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 720 },
      },
    },
  ],
  webServer: {
    command: "npm run start --workspace @accesspath/demo-aid-app",
    url: `${baseURL}/health`,
    env: {
      DEMO_AID_APP_PORT: String(port),
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
