export interface Command {
  // biome-ignore lint/suspicious/noConfusingVoidType: existing commands return void; false alone rejects a transaction.
  execute(): void | boolean;
  // biome-ignore lint/suspicious/noConfusingVoidType: existing commands return void; false alone rejects a transaction.
  undo(): void | boolean;
  discard?(): void;
}

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize = 50;

  constructor(
    private readonly onMutation: () => void = () => {},
    private readonly canMutate: () => boolean = () => true,
    private readonly onRejected: () => void = () => {},
  ) {}

  push(cmd: Command): boolean {
    if (!this.canMutate()) {
      this.onRejected();
      return false;
    }
    if (cmd.execute() === false) return false;
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxSize) {
      const evicted = this.undoStack.shift();
      if (evicted) this.discard(evicted);
    }
    for (const command of this.redoStack) this.discard(command);
    this.redoStack = [];
    this.onMutation();
    return true;
  }

  undo(): boolean {
    if (!this.canMutate()) {
      this.onRejected();
      return false;
    }
    const cmd = this.undoStack.at(-1);
    if (!cmd || cmd.undo() === false) return false;
    this.undoStack.pop();
    this.redoStack.push(cmd);
    this.onMutation();
    return true;
  }

  redo(): boolean {
    if (!this.canMutate()) {
      this.onRejected();
      return false;
    }
    const cmd = this.redoStack.at(-1);
    if (!cmd || cmd.execute() === false) return false;
    this.redoStack.pop();
    this.undoStack.push(cmd);
    this.onMutation();
    return true;
  }

  clear(): void {
    for (const command of this.undoStack) this.discard(command);
    for (const command of this.redoStack) this.discard(command);
    this.undoStack = [];
    this.redoStack = [];
  }

  private discard(command: Command): void {
    try {
      command.discard?.();
    } catch (error) {
      console.error("[Editor] Command cleanup failed:", error);
    }
  }
}
