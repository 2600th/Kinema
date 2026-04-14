import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["visual-check.ts", "vehicle-controllers.ts", "vfx-particles.ts", "jump-mechanics.ts", "station-screenshots.ts", "physics-verification.ts", "procedural-review-screenshots.ts", "procedural-coins.ts", "procedural-hazards.ts", "pause-pointer-lock.ts", "beacon-hold-objective.ts", "mobile-touch-controls.ts", "mobile-orientation.ts", "mobile-landscape-layout.ts", "mobile-compat-procedural.ts", "menu-responsive.ts"],
  timeout: 120_000,
  workers: 2,
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
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
