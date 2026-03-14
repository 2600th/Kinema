import type { Disposable } from "./types";

/** Interface for game subsystems registered with Game. */
export interface RuntimeSystem extends Disposable {
  readonly id: string;
  setupLevel?(): void;
  teardownLevel?(): void;
  fixedUpdate?(dt: number): void;
  postPhysicsUpdate?(dt: number): void;
  update?(dt: number, alpha: number): void;
}
