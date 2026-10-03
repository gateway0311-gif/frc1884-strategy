import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// End-to-end check of the hub in a real browser, against a throwaway database
// seeded with the demo event. Run with: npm run test:e2e
const PORT = 3210;
const database = path.join(os.tmpdir(), `hub-e2e-${process.pid}.db`);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 390, height: 844 } },
  webServer: {
    command: "npx tsx scripts/seed-demo.ts && npx tsx src/server.ts",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      HOST: "127.0.0.1",
      DATABASE_PATH: database,
      SCOUT_CODE: "e2e-scout",
      MANAGER_CODE: "e2e-manager",
      STRATEGIST_CODE: "e2e-strategist",
      LEAD_CODE: "e2e-lead",
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret",
    },
  },
});
