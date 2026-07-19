export type EditorLoadKind = "user-load" | "playtest-restore";
export type EditorLoadToken = Readonly<{ generation: number; kind: EditorLoadKind }>;
export type EditorLoadCompletion = "completed" | "superseded";

export class EditorLoadTransaction {
  private currentGeneration = 0;
  private activeToken: EditorLoadToken | null = null;

  get generation(): number {
    return this.currentGeneration;
  }

  get isBusy(): boolean {
    return this.activeToken !== null;
  }

  get canMutate(): boolean {
    return !this.isBusy;
  }

  begin(kind: EditorLoadKind = "user-load"): EditorLoadToken | null {
    if (this.isBusy) return null;
    const token = Object.freeze({ generation: ++this.currentGeneration, kind });
    this.activeToken = token;
    return token;
  }

  isCurrent(token: EditorLoadToken): boolean {
    return this.activeToken === token && this.currentGeneration === token.generation;
  }

  isGenerationCurrent(generation: number): boolean {
    return this.currentGeneration === generation;
  }

  finish(token: EditorLoadToken): EditorLoadCompletion {
    if (!this.isCurrent(token)) return "superseded";
    this.activeToken = null;
    return "completed";
  }

  invalidate(): void {
    this.currentGeneration++;
    this.activeToken = null;
  }
}
