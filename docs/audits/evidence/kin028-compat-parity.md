# KIN-028 Compatibility Renderer Evidence

Captured 2026-07-21 with Playwright Chromium on the repository's SwiftShader launch configuration. This is a repeatable software-GPU/mobile proxy, not Safari or iOS hardware certification.

## Mobile performance A/B

Both paths used an iPhone-like 844 x 390 context, the VFX station, the balanced profile, 4x CDP CPU throttling, an excluded 300-frame warmup, and three independent 300-frame measurement windows. `compatPost=0` was measured in a fresh context before the enabled path.

| Path | Window p95 values (ms) | Median p95 | Runtime errors |
|---|---:|---:|---:|
| Bare `compatPost=0` | 133.40, 166.60, 150.00 | 150.00 ms | 0 |
| Enabled compatibility post | 133.40, 166.60, 133.30 | 133.40 ms | 0 |

The enabled/bare median ratio was 0.889, inside the required maximum of 1.10. It should be treated as a non-regression observation on this proxy, not evidence of a performance improvement on physical Apple hardware.

Full-suite revalidation later on 2026-07-21 found a repeatable sustained-load ratio of 1.143 with the original 4x offscreen MSAA cap. Reducing only the cap to 2x, while retaining the 0.75 internal scale and unchanged half-float `RenderPass -> CompatGradePass` stack, produced bare p95 windows of `233.4, 233.4, 233.3ms` and enabled windows of `266.5, 250.0, 250.0ms`. The median ratio was `250.0 / 233.4 = 1.071`, inside the unchanged 1.10 gate, with zero runtime errors.

Final variance work on 2026-07-22 replaced the order-biased sequential measurement with four fresh matched pairs in balanced `AB/BA/BA/AB` order, one excluded 300-frame warmup, and one 300-frame measurement per arm. That gate reproduced a 1.133 median at 0.75 scale. The final 0.70 scale plus an inactive-vignette shader fast path retained half-float grading, LUT, and 2x MSAA. Two isolated runs produced median pairwise ratios of `1.0668` and `1.0664`; two later whole-suite executions produced `1.0716` and `1.0718`. Every run stayed inside the unchanged 1.10 limit with zero runtime errors. The four renderer-path VFX slice passed 6/6, and mobile plus desktop captures were inspected for sign text, silhouettes, lasers, coins, and floor edges.

## Visual and structural parity

- `tests/visual-regression.ts-snapshots/vfx-default-chromium-win32.png`
- `tests/visual-regression.ts-snapshots/vfx-forced-webgpu-webgl2-chromium-win32.png`
- `tests/visual-regression.ts-snapshots/vfx-compat-webgl-chromium-win32.png`
- `tests/visual-regression.ts-snapshots/vfx-bare-compat-webgl-chromium-win32.png`

The serial path harness passed for all four captures and confirmed matching visible bounds for `StationFloor_col`, `ShowcaseBay0_col`, `ShowcaseBayAccent0`, and `VFX_StationSign`. The enabled compatibility capture was visually inspected after generation; the bare capture was force-refreshed so its compatibility-specific VFX copy is represented in the pixels, not only in the DOM assertion.
