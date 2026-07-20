# KIN-028 Compatibility Renderer Evidence

Captured 2026-07-21 with Playwright Chromium on the repository's SwiftShader launch configuration. This is a repeatable software-GPU/mobile proxy, not Safari or iOS hardware certification.

## Mobile performance A/B

Both paths used an iPhone-like 844 x 390 context, the VFX station, the balanced profile, 4x CDP CPU throttling, an excluded 300-frame warmup, and three independent 300-frame measurement windows. `compatPost=0` was measured in a fresh context before the enabled path.

| Path | Window p95 values (ms) | Median p95 | Runtime errors |
|---|---:|---:|---:|
| Bare `compatPost=0` | 133.40, 166.60, 150.00 | 150.00 ms | 0 |
| Enabled compatibility post | 133.40, 166.60, 133.30 | 133.40 ms | 0 |

The enabled/bare median ratio was 0.889, inside the required maximum of 1.10. The result includes the final half-float `RenderPass -> CompatGradePass` stack at 0.75 internal resolution with device-capped 4x MSAA. It should be treated as a non-regression observation on this proxy, not evidence of a performance improvement on physical Apple hardware.

## Visual and structural parity

- `tests/visual-regression.ts-snapshots/vfx-default-chromium-win32.png`
- `tests/visual-regression.ts-snapshots/vfx-forced-webgpu-webgl2-chromium-win32.png`
- `tests/visual-regression.ts-snapshots/vfx-compat-webgl-chromium-win32.png`
- `tests/visual-regression.ts-snapshots/vfx-bare-compat-webgl-chromium-win32.png`

The serial path harness passed for all four captures and confirmed matching visible bounds for `StationFloor_col`, `ShowcaseBay0_col`, `ShowcaseBayAccent0`, and `VFX_StationSign`. The enabled compatibility capture was visually inspected after generation; the bare capture was force-refreshed so its compatibility-specific VFX copy is represented in the pixels, not only in the DOM assertion.
