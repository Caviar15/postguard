import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: /signed-in\.spec\.ts/, workers: 1, reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3100" },
});
