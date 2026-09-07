import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/e2e.spec.ts",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  webServer: [
    {
      command: "npm run dev -- --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
    },
    {
      command: "npm run preview -- --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
    },
  ],
  use: {
    baseURL: process.env.ECHO_TEST_URL || "http://127.0.0.1:5173",
    headless: true,
    viewport: { width: 1512, height: 1050 },
    channel: "chrome",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
