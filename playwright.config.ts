import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke only. The unit and component suites carry the detail; these four specs
 * exist to catch the class of failure that only shows up in a real browser —
 * the app not booting, a theme not applying, a route tree out of step.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Honour a pre-installed browser where the environment provides one
        // rather than downloading a second copy.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // `vite dev`, not `vite preview`: the production build targets a
        // Cloudflare Worker, which the preview server cannot serve.
        command: "npx vite dev --port 4173 --host 127.0.0.1",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
