import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  // The app currently loads Supabase from esm.sh; serial smoke tests avoid CDN throttling.
  workers: 1,
  reporter: "line",
  webServer: {
    command: "python -m http.server 8765 --bind 127.0.0.1",
    url: "http://127.0.0.1:8765/login.html",
    reuseExistingServer: true,
    timeout: 15_000
  },
  use: {
    baseURL: "http://127.0.0.1:8765",
    trace: "retain-on-failure"
  }
});
