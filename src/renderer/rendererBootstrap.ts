import type { GraphicsProfile } from "@core/UserSettings";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { getRendererMaxPixelRatio } from "./pipelineProfile";

export interface DeviceLostInfo {
  api: string;
  message: string;
  reason: string | null;
}

export function createFallbackRenderer(exposure: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.info.autoReset = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0xd8dce8, 1);
  return renderer;
}

export async function createWebGpuRenderer(options: {
  forceWebGL: boolean;
  profile: GraphicsProfile;
  shadowsEnabled: boolean;
  exposure: number;
  onDeviceLost: (info: DeviceLostInfo) => void;
}): Promise<WebGPURenderer> {
  const renderer = new WebGPURenderer({
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    forceWebGL: options.forceWebGL,
  });
  (renderer as unknown as { info?: { autoReset?: boolean } }).info!.autoReset = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, getRendererMaxPixelRatio(options.profile)));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = options.exposure;
  renderer.shadowMap.enabled = options.shadowsEnabled;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  await (renderer as unknown as { init(): Promise<void> }).init();

  const deviceLossCapable = renderer as unknown as {
    onDeviceLost?: ((info: DeviceLostInfo) => void) | null;
  };
  const defaultDeviceLossHandler =
    typeof deviceLossCapable.onDeviceLost === "function" ? deviceLossCapable.onDeviceLost.bind(renderer) : null;
  deviceLossCapable.onDeviceLost = (info) => {
    defaultDeviceLossHandler?.(info);
    options.onDeviceLost(info);
  };

  return renderer;
}

export function attachRendererCanvas(renderer: THREE.WebGLRenderer | WebGPURenderer): void {
  const canvas = renderer.domElement;
  if (canvas.parentElement === document.body) return;
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.zIndex = "0";
  document.body.appendChild(canvas);
}

export function showDeviceLostOverlay(info: DeviceLostInfo): void {
  if (document.getElementById("device-lost-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "device-lost-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "99999",
    background: "rgba(0,0,0,0.85)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontFamily: "system-ui, sans-serif",
    textAlign: "center",
  } as CSSStyleDeclaration);

  const h1 = document.createElement("h1");
  h1.textContent = "GPU Device Lost";
  h1.style.margin = "0 0 12px";

  const desc = document.createElement("p");
  desc.textContent =
    "The GPU connection was lost. This can happen when the driver crashes or the system resumes from sleep.";
  Object.assign(desc.style, { maxWidth: "420px", lineHeight: "1.5", opacity: "0.8" });

  const detail = document.createElement("p");
  detail.textContent = `${info.api}: ${info.message || "unknown"}`;
  Object.assign(detail.style, {
    fontSize: "12px",
    opacity: "0.5",
    fontFamily: "monospace",
    margin: "8px 0 24px",
  });

  const btn = document.createElement("button");
  btn.textContent = "Reload Page";
  Object.assign(btn.style, {
    padding: "10px 28px",
    fontSize: "16px",
    cursor: "pointer",
    border: "none",
    borderRadius: "6px",
    background: "#4488ff",
    color: "#fff",
  });
  btn.addEventListener("click", () => window.location.reload());

  overlay.append(h1, desc, detail, btn);
  document.body.appendChild(overlay);
}
