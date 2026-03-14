import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["visual-check.ts", "vehicle-controllers.ts", "vfx-particles.ts", "jump-mechanics.ts", "station-screenshots.ts", "physics-verification.ts"],
  timeout: 60_000,
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    // Allow WebGL/WebGPU content to render with GPU acceleration
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-gpu-rasterization",
        "--enable-webgpu-developer-features",
        "--enable-unsafe-webgpu",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
