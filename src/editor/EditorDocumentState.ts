export interface EditorDocumentSnapshot {
  name: string;
  dirty: boolean;
}

export type EditorLevelIdentity = Readonly<{
  name: string;
  origin: "system" | "authored";
  kind: "procedural" | "station" | "asset" | "authored";
}>;

export function normalizeEditorDocumentName(identity: EditorLevelIdentity | null): string {
  return !identity || identity.kind === "procedural" || identity.kind === "station" ? "Untitled" : identity.name;
}

export function shouldProtectEditorUnload(
  dirty: boolean,
  active: boolean,
  playTesting: boolean,
  restoring: boolean,
): boolean {
  return dirty && (active || playTesting || restoring);
}

export class EditorDocumentState {
  private name = "Untitled";
  private dirty = false;

  constructor(private readonly onChange: (value: Readonly<EditorDocumentSnapshot>) => void = () => {}) {}

  get value(): Readonly<EditorDocumentSnapshot> {
    return { name: this.name, dirty: this.dirty };
  }

  markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.onChange(this.value);
  }

  markClean(name: string): void {
    const nextName = name.trim() || "Untitled";
    if (!this.dirty && this.name === nextName) return;
    this.name = nextName;
    this.dirty = false;
    this.onChange(this.value);
  }
}
