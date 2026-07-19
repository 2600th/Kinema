export interface Command {
  // biome-ignore lint/suspicious/noConfusingVoidType: existing commands return void; false alone rejects a transaction.
  execute(): void | boolean;
  // biome-ignore lint/suspicious/noConfusingVoidType: existing commands return void; false alone rejects a transaction.
  undo(): void | boolean;
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
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
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
    this.undoStack = [];
    this.redoStack = [];
  }
}
