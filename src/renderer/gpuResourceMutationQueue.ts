export type GpuResourceMutation = () => void;
export type GpuResourceMutationScheduler = (key: string, mutation: GpuResourceMutation) => void;

/**
 * Coalesces GPU resource mutations behind a submitted-work barrier.
 * Rendering stays suspended until every mutation queued for the drained boundary
 * has run, so callbacks may safely dispose or resize backend resources.
 */
export class GpuResourceMutationQueue {
  private readonly pending = new Map<string, GpuResourceMutation>();
  private draining = false;
  private disposed = false;
  private renderingSuspended = false;
  private idlePromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly waitForSubmittedWork: () => Promise<void>,
    private readonly setRenderingSuspended: (suspended: boolean) => void,
    private readonly reportError: (error: unknown) => void = (error) => {
      console.warn("[RendererManager] GPU resource mutation failed:", error);
    },
  ) {}

  enqueue(key: string, mutation: GpuResourceMutation): void {
    if (this.disposed) return;
    this.pending.set(key, mutation);
    if (!this.draining) this.startDrain();
  }

  whenIdle(): Promise<void> {
    return this.idlePromise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    this.resumeRendering();
  }

  private startDrain(): void {
    this.draining = true;
    this.suspendRendering();
    this.idlePromise = this.drain();
  }

  private async drain(): Promise<void> {
    try {
      while (!this.disposed && this.pending.size > 0) {
        await this.waitForSubmittedWork();
        if (this.disposed) break;

        const mutations = [...this.pending.values()];
        this.pending.clear();
        for (const mutation of mutations) {
          if (this.disposed) break;
          try {
            mutation();
          } catch (error) {
            this.reportError(error);
          }
        }
      }
    } catch (error) {
      this.pending.clear();
      this.reportError(error);
    } finally {
      this.draining = false;
      if (this.disposed || this.pending.size === 0) {
        this.resumeRendering();
      } else {
        this.startDrain();
      }
    }
  }

  private suspendRendering(): void {
    if (this.renderingSuspended) return;
    this.renderingSuspended = true;
    this.setRenderingSuspended(true);
  }

  private resumeRendering(): void {
    if (!this.renderingSuspended) return;
    this.renderingSuspended = false;
    this.setRenderingSuspended(false);
  }
}
