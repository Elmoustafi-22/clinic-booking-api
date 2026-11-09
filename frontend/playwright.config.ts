import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
process.env.CLINICSLOT_TEST_KEY ??= randomBytes(32).toString("hex");
const key = process.env.CLINICSLOT_TEST_KEY;
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/start-backend.mjs",
      url: "http://127.0.0.1:3101/slots",
      timeout: 120000,
      reuseExistingServer: false,
      env: { API_KEY: key },
    },
    {
      command:
        "node node_modules/next/dist/bin/next start -p 3100 -H 127.0.0.1",
      url: "http://127.0.0.1:3100",
      timeout: 120000,
      reuseExistingServer: false,
      env: { API_KEY: key, BACKEND_API_URL: "http://127.0.0.1:3101" },
    },
  ],
});
