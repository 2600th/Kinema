type PointerLockRequest = (options?: unknown) => Promise<void> | void;

type PointerLockCapableCanvas = HTMLCanvasElement & {
  requestPointerLock?: PointerLockRequest;
};

type PointerLockCapableDocument = Document & {
  exitPointerLock?: (() => Promise<void> | void) | undefined;
};

export function getPointerLockRequest(canvas: HTMLCanvasElement): PointerLockRequest | null {
  const requestPointerLock = (canvas as PointerLockCapableCanvas).requestPointerLock;
  return typeof requestPointerLock === "function" ? requestPointerLock.bind(canvas) : null;
}

export function exitPointerLockIfSupported(doc: Document = document): void {
  const exitPointerLock = (doc as PointerLockCapableDocument).exitPointerLock;
  if (typeof exitPointerLock !== "function") return;

  try {
    void exitPointerLock.call(doc);
  } catch {
    // Browsers without full Pointer Lock support may still throw here.
  }
}
