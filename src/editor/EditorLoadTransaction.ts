export class EditorLoadTransaction {
  private generation = 0;
  private activeToken: number | null = null;

  get isBusy(): boolean {
    return this.activeToken !== null;
  }

  get canMutate(): boolean {
    return !this.isBusy;
  }

  begin(): number | null {
    if (this.isBusy) return null;
    const token = ++this.generation;
    this.activeToken = token;
    return token;
  }

  isCurrent(token: number): boolean {
    return this.activeToken === token && this.generation === token;
  }

  finish(token: number): void {
    if (this.isCurrent(token)) this.activeToken = null;
  }

  invalidate(): void {
    this.generation++;
    this.activeToken = null;
  }
}
