import { describe, expect, it, vi } from "vitest";
import { type Command, CommandHistory } from "./CommandHistory";

function createCommand(label: string, events: string[]): Command {
  return {
    execute: vi.fn(() => events.push(`execute:${label}`)),
    undo: vi.fn(() => events.push(`undo:${label}`)),
  };
}

describe("CommandHistory", () => {
  it("executes commands and preserves undo and redo ordering", () => {
    const events: string[] = [];
    const history = new CommandHistory();
    const first = createCommand("first", events);
    const second = createCommand("second", events);

    history.push(first);
    history.push(second);
    history.undo();
    history.undo();
    history.redo();
    history.redo();

    expect(events).toEqual([
      "execute:first",
      "execute:second",
      "undo:second",
      "undo:first",
      "execute:first",
      "execute:second",
    ]);
  });

  it("evicts the oldest command when the 50-entry history limit is exceeded", () => {
    const events: string[] = [];
    const history = new CommandHistory();
    const commands = Array.from({ length: 51 }, (_, index) => createCommand(String(index), events));

    for (const command of commands) history.push(command);
    for (let index = 0; index < 51; index++) history.undo();

    expect(commands[0]?.undo).not.toHaveBeenCalled();
    for (const command of commands.slice(1)) {
      expect(command.undo).toHaveBeenCalledTimes(1);
    }
  });

  it("invalidates the redo stack when a new command is pushed", () => {
    const events: string[] = [];
    const history = new CommandHistory();
    const abandoned = createCommand("abandoned", events);
    const replacement = createCommand("replacement", events);

    history.push(abandoned);
    history.undo();
    history.push(replacement);
    history.redo();

    expect(abandoned.execute).toHaveBeenCalledTimes(1);
    expect(replacement.execute).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["execute:abandoned", "undo:abandoned", "execute:replacement"]);
  });

  it("treats undo and redo on empty stacks as no-ops", () => {
    const history = new CommandHistory();

    expect(() => history.undo()).not.toThrow();
    expect(() => history.redo()).not.toThrow();
    history.clear();
    expect(() => history.undo()).not.toThrow();
    expect(() => history.redo()).not.toThrow();
  });

  it("notifies once for each successful mutation but not empty operations or clear", () => {
    const onMutation = vi.fn();
    const history = new CommandHistory(onMutation);

    history.undo();
    history.redo();
    history.clear();

    expect(onMutation).not.toHaveBeenCalled();

    history.push(createCommand("first", []));
    history.undo();
    history.redo();

    expect(onMutation).toHaveBeenCalledTimes(3);
  });

  it("rejects execute, undo, and redo while mutations are locked", () => {
    let canMutate = true;
    const onRejected = vi.fn();
    const events: string[] = [];
    const history = new CommandHistory(() => {}, () => canMutate, onRejected);
    const command = createCommand("locked", events);

    canMutate = false;
    history.push(command);
    expect(events).toEqual([]);

    canMutate = true;
    history.push(command);
    canMutate = false;
    history.undo();
    history.redo();

    expect(events).toEqual(["execute:locked"]);
    expect(onRejected).toHaveBeenCalledTimes(3);
  });
});
