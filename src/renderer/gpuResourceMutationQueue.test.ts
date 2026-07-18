import { describe, expect, it, vi } from "vitest";
import { GpuResourceMutationQueue } from "./gpuResourceMutationQueue";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("GpuResourceMutationQueue", () => {
  it("pauses rendering, drains submitted work, and applies only the latest keyed mutation", async () => {
    const idle = deferred();
    const renderingSuspended: boolean[] = [];
    const firstMutation = vi.fn();
    const latestMutation = vi.fn();
    const shadowMutation = vi.fn();
    const queue = new GpuResourceMutationQueue(
      () => idle.promise,
      (suspended) => renderingSuspended.push(suspended),
    );

    queue.enqueue("graphics-profile", firstMutation);
    queue.enqueue("graphics-profile", latestMutation);
    queue.enqueue("shadow-quality", shadowMutation);

    expect(renderingSuspended).toEqual([true]);
    expect(firstMutation).not.toHaveBeenCalled();
    expect(latestMutation).not.toHaveBeenCalled();
    expect(shadowMutation).not.toHaveBeenCalled();

    idle.resolve();
    await vi.waitFor(() => expect(latestMutation).toHaveBeenCalledOnce());

    expect(firstMutation).not.toHaveBeenCalled();
    expect(shadowMutation).toHaveBeenCalledOnce();
    expect(latestMutation.mock.invocationCallOrder[0]).toBeLessThan(shadowMutation.mock.invocationCallOrder[0]);
    expect(renderingSuspended).toEqual([true, false]);
  });

  it("drops pending mutations and resumes rendering when disposed during a drain", async () => {
    const idle = deferred();
    const renderingSuspended: boolean[] = [];
    const mutation = vi.fn();
    const queue = new GpuResourceMutationQueue(
      () => idle.promise,
      (suspended) => renderingSuspended.push(suspended),
    );

    queue.enqueue("shadow-quality", mutation);
    queue.dispose();
    idle.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mutation).not.toHaveBeenCalled();
    expect(renderingSuspended).toEqual([true, false]);
  });

  it("reports a failed barrier and always resumes rendering", async () => {
    const renderingSuspended: boolean[] = [];
    const mutation = vi.fn();
    const reportError = vi.fn();
    const queue = new GpuResourceMutationQueue(
      () => Promise.reject(new Error("device lost")),
      (suspended) => renderingSuspended.push(suspended),
      reportError,
    );

    queue.enqueue("graphics-profile", mutation);
    await queue.whenIdle();

    expect(mutation).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledOnce();
    expect(renderingSuspended).toEqual([true, false]);
  });
});
