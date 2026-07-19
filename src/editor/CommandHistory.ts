export interface Command {
  execute(): void;
  undo(): void;
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

  push(cmd: Command): void {
    if (!this.canMutate()) {
      this.onRejected();
      return;
    }
    cmd.execute();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.onMutation();
  }

  undo(): void {
    if (!this.canMutate()) {
      this.onRejected();
      return;
    }
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.onMutation();
  }

  redo(): void {
    if (!this.canMutate()) {
      this.onRejected();
      return;
    }
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
    this.onMutation();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
