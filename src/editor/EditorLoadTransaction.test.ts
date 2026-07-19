import { describe, expect, it } from "vitest";
import { EditorLoadTransaction } from "./EditorLoadTransaction";

describe("EditorLoadTransaction", () => {
  it("rejects a second load and mutations until the active load finishes", () => {
    const transaction = new EditorLoadTransaction();

    const token = transaction.begin();

    expect(token).not.toBeNull();
    if (token === null) throw new Error("Expected a load token");
    expect(transaction.isBusy).toBe(true);
    expect(transaction.canMutate).toBe(false);
    expect(transaction.begin()).toBeNull();

    transaction.finish(token);

    expect(transaction.isBusy).toBe(false);
    expect(transaction.canMutate).toBe(true);
  });

  it("invalidates stale async completions so they cannot finish the next document", () => {
    const transaction = new EditorLoadTransaction();
    const staleToken = transaction.begin();
    transaction.invalidate();
    const currentToken = transaction.begin();

    expect(staleToken).not.toBeNull();
    expect(currentToken).not.toBeNull();
    if (staleToken === null || currentToken === null) throw new Error("Expected load tokens");
    expect(transaction.isCurrent(staleToken)).toBe(false);
    expect(transaction.isCurrent(currentToken)).toBe(true);

    transaction.finish(staleToken);
    expect(transaction.isBusy).toBe(true);

    transaction.finish(currentToken);
    expect(transaction.isBusy).toBe(false);
  });

  it("distinguishes completed user loads from superseded play-test restores", () => {
    const transaction = new EditorLoadTransaction();
    const initialGeneration = transaction.generation;
    const userLoad = transaction.begin("user-load");

    expect(userLoad).not.toBeNull();
    if (userLoad === null) throw new Error("Expected a user-load token");
    expect(userLoad.kind).toBe("user-load");
    expect(transaction.generation).toBeGreaterThan(initialGeneration);
    expect(transaction.finish(userLoad)).toBe("completed");

    const restore = transaction.begin("playtest-restore");
    expect(restore).not.toBeNull();
    if (restore === null) throw new Error("Expected a restore token");
    transaction.invalidate();

    expect(transaction.finish(restore)).toBe("superseded");
    expect(transaction.isBusy).toBe(false);
  });

  it("invalidates async work captured before a newer lifecycle begins", () => {
    const transaction = new EditorLoadTransaction();
    const importGeneration = transaction.generation;

    const load = transaction.begin("user-load");

    expect(load).not.toBeNull();
    expect(transaction.isGenerationCurrent(importGeneration)).toBe(false);
    expect(transaction.isGenerationCurrent(transaction.generation)).toBe(true);
  });
});
