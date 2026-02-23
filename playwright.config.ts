import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "visual-check.ts",
  timeout: 30_000,
  use: {
    headless: true,
    viewport: { width: 1920, height: 1080 },
    // Allow WebGL/WebGPU content to render
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
