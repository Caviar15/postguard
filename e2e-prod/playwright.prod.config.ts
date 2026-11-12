import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: /probe\.spec\.ts/,
  fullyParallel: true,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"] },
});
