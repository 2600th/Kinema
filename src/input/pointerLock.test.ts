import { describe, expect, it, vi } from "vitest";
import { exitPointerLockIfSupported, getPointerLockRequest } from "./pointerLock";

describe("pointerLock helpers", () => {
  it("returns null when requestPointerLock is unavailable", () => {
    expect(getPointerLockRequest({} as HTMLCanvasElement)).toBeNull();
  });

  it("binds requestPointerLock to the canvas", () => {
    const requestPointerLock = vi.fn();
    const canvas = { requestPointerLock } as unknown as HTMLCanvasElement;

    const request = getPointerLockRequest(canvas);
    request?.({ preferRaw: true });

    expect(requestPointerLock).toHaveBeenCalledWith({ preferRaw: true });
  });

  it("ignores missing exitPointerLock support", () => {
    expect(() => exitPointerLockIfSupported({} as Document)).not.toThrow();
  });

  it("calls exitPointerLock when the API exists", () => {
    const exitPointerLock = vi.fn();

    exitPointerLockIfSupported({ exitPointerLock } as unknown as Document);

    expect(exitPointerLock).toHaveBeenCalledTimes(1);
  });
});
