import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createShowcaseSkyTexture,
  DEFAULT_SHOWCASE_ART_DIRECTION_ID,
  resolveShowcaseArtDirectionId,
  SHOWCASE_ART_DIRECTIONS,
} from "./showcaseArtDirection";

describe("showcase art direction", () => {
  it("defines the three approved sky and fog candidates exactly", () => {
    expect(SHOWCASE_ART_DIRECTIONS).toEqual({
      dawn: {
        id: "dawn",
        label: "Dawn Slate",
        stops: [
          { v: 0, color: "#35414f" },
          { v: 0.44, color: "#71808e" },
          { v: 0.5, color: "#8e99a6" },
          { v: 0.56, color: "#c58f78" },
          { v: 0.72, color: "#40536a" },
          { v: 1, color: "#111827" },
        ],
        fog: { color: "#8e99a6", near: 95, far: 360 },
      },
      aurora: {
        id: "aurora",
        label: "Aurora Lab",
        stops: [
          { v: 0, color: "#314a52" },
          { v: 0.44, color: "#66888a" },
          { v: 0.5, color: "#8fa9aa" },
          { v: 0.56, color: "#b8dccb" },
          { v: 0.72, color: "#245665" },
          { v: 1, color: "#071a2c" },
        ],
        fog: { color: "#8fa9aa", near: 110, far: 400 },
      },
      dusk: {
        id: "dusk",
        label: "Violet Dusk",
        stops: [
          { v: 0, color: "#3e4051" },
          { v: 0.44, color: "#706d80" },
          { v: 0.5, color: "#918b9c" },
          { v: 0.56, color: "#c9868b" },
          { v: 0.72, color: "#59405f" },
          { v: 1, color: "#181129" },
        ],
        fog: { color: "#918b9c", near: 90, far: 330 },
      },
    });
    expect(DEFAULT_SHOWCASE_ART_DIRECTION_ID).toBe("dawn");
  });

  it("resolves supported query values and falls back to Dawn Slate", () => {
    expect(resolveShowcaseArtDirectionId("aurora")).toBe("aurora");
    expect(resolveShowcaseArtDirectionId("DUSK")).toBe("dusk");
    expect(resolveShowcaseArtDirectionId(null)).toBe("dawn");
    expect(resolveShowcaseArtDirectionId("unknown")).toBe("dawn");
  });

  it("builds a world-locked 512x256 sRGB gradient texture without mipmaps", () => {
    const texture = createShowcaseSkyTexture(SHOWCASE_ART_DIRECTIONS.dawn);

    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(texture.image.width).toBe(512);
    expect(texture.image.height).toBe(256);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    expect(texture.magFilter).toBe(THREE.LinearFilter);
    expect(texture.generateMipmaps).toBe(false);

    const data = texture.image.data as Uint8Array;
    const firstPixel = [...data.slice(0, 4)];
    const lastRowOffset = (texture.image.height - 1) * texture.image.width * 4;
    const lastPixel = [...data.slice(lastRowOffset, lastRowOffset + 4)];
    expect(firstPixel).toEqual([0x35, 0x41, 0x4f, 0xff]);
    expect(lastPixel).toEqual([0x11, 0x18, 0x27, 0xff]);

    const row = 128;
    const leftOffset = row * texture.image.width * 4;
    const rightOffset = leftOffset + (texture.image.width - 1) * 4;
    expect([...data.slice(leftOffset, leftOffset + 4)]).toEqual([0x90, 0x99, 0xa5, 0xff]);
    expect([...data.slice(leftOffset, leftOffset + 4)]).toEqual([...data.slice(rightOffset, rightOffset + 4)]);
  });
});
