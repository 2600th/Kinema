import path from "node:path";
import { expect, test } from "@playwright/test";
import { waitForGrounded, waitForKinema } from "./helpers/kinema";

async function startProceduralRun(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.locator(".loading-screen").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 120_000 });
  await waitForGrounded(page);
}

async function openEditor(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => window.__KINEMA__.openEditor());
  await page.waitForFunction(() => window.__KINEMA__.isEditorActive(), undefined, { timeout: 60_000 });
}

async function placeBlock(page: import("@playwright/test").Page): Promise<void> {
  await page.locator(".ke-brush-item").filter({ hasText: "Block" }).click();
  await page.locator("canvas").evaluate(async (canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect();
    const clientX = bounds.left + bounds.width * 0.5;
    const clientY = bounds.top + bounds.height * 0.6;
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX, clientY }));
  });
}

async function placeCurrentPreview(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("canvas").evaluate(async (canvas: HTMLCanvasElement) => {
    const bounds = canvas.getBoundingClientRect();
    const clientX = bounds.left + bounds.width * 0.5;
    const clientY = bounds.top + bounds.height * 0.6;
    canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX, clientY }));
  });
}

test("explains session-only and missing GLB models", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem("kinema.user-settings.v1", JSON.stringify({ graphicsProfile: "performance" }));
  });
  await page.goto("/?station=steps", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await waitForGrounded(page);
  await openEditor(page);

  const objectCountBeforeImport = await page.evaluate(() => window.__KINEMA__.getEditorObjectCount());
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("Import GLB").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(
    path.resolve(
      "public/assets/models/Universal Animation Library 2[Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb",
    ),
  );

  const noticeCopy =
    "Imported model is session-only — copy it to public/assets/models/ to keep it after reload.";
  const sessionNotice = page.locator('.ke-session-import-notice[role="status"]');
  await expect(sessionNotice).toContainText(noticeCopy, { timeout: 60_000 });
  await expect(sessionNotice.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
  await page.screenshot({ path: "docs/audits/evidence/29-glb-session-banner.png" });
  await sessionNotice.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(sessionNotice).toBeHidden();

  await placeCurrentPreview(page);
  await expect
    .poll(() => page.evaluate(() => window.__KINEMA__.getEditorObjectCount()))
    .toBe(objectCountBeforeImport + 1);

  page.once("dialog", (dialog) => void dialog.accept("kin021-session-model"));
  const downloadPromise = page.waitForEvent("download");
  await page.getByTitle(/Save \(Ctrl\+S\)/).click();
  await downloadPromise;
  await expect(page.locator(".ke-document-title")).toHaveText("kin021-session-model");

  await page.evaluate(() => window.history.replaceState(null, "", "/"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await page.getByRole("button", { name: "Level Select", exact: true }).click();
  const savedCard = page.locator(".menu-level-card").filter({ hasText: "kin021-session-model" });
  await savedCard.getByRole("button", { name: "Play", exact: true }).click();
  await page.locator(".loading-screen").waitFor({ state: "hidden", timeout: 120_000 });
  await page.keyboard.press("F1");
  await page.waitForFunction(() => window.__KINEMA__.isEditorActive(), undefined, { timeout: 60_000 });
  await expect(page.locator(".ke-document-title")).toHaveText("kin021-session-model");

  const warningLabel = "GLB unavailable; placeholder shown.";
  const hierarchyWarning = page.locator(`.ke-tree-row-warning[aria-label="${warningLabel}"]`);
  await expect(hierarchyWarning).toBeVisible();
  await hierarchyWarning.locator("..").click();
  await expect(hierarchyWarning.locator("..")).toHaveClass(/ke-tree-row-selected/);
  await expect(page.locator(".ke-inspector-warning")).toHaveText(
    "Model unavailable: /assets/models/Mannequin_F.glb. Kinema is showing a placeholder. " +
      "Copy the original file to public/assets/models/ and reload the level.",
  );
  await page.screenshot({ path: "docs/audits/evidence/30-glb-placeholder.png" });
});

test("protects unsaved editor work and saves through Ctrl+S", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem("kinema.user-settings.v1", JSON.stringify({ graphicsProfile: "performance" }));
  });
  await page.goto("/?station=steps", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await waitForGrounded(page);
  await openEditor(page);

  const initialObjectCount = await page.evaluate(() => window.__KINEMA__.getEditorObjectCount());
  await placeBlock(page);
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(initialObjectCount + 1);
  await expect(page.locator(".ke-dirty-dot")).toBeVisible();
  await expect(page.locator(".ke-document-title")).toHaveText("Untitled*");
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState())).toEqual({
    name: "Untitled",
    dirty: true,
  });
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      const dispatched = window.dispatchEvent(event);
      return {
        dispatched,
        defaultPrevented: event.defaultPrevented,
        debug: window.__KINEMA__.getEditorUnloadProtectionState(),
      };
    }),
  ).toEqual({
    dispatched: false,
    defaultPrevented: true,
    debug: { registered: true, lastPrevented: true },
  });

  await page.evaluate(() => window.__KINEMA__.startPlayTest());
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(true);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState().dirty)).toBe(true);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorUnloadProtectionState().registered)).toBe(true);
  const stopBoundary = await page.evaluate(async () => {
    const stopPromise = window.__KINEMA__.stopPlayTest();
    const event = new Event("beforeunload", { cancelable: true });
    const dispatched = window.dispatchEvent(event);
    const during = {
      dispatched,
      defaultPrevented: event.defaultPrevented,
      debug: window.__KINEMA__.getEditorUnloadProtectionState(),
    };
    await stopPromise;
    return { during };
  });
  expect(stopBoundary.during).toEqual({
    dispatched: false,
    defaultPrevented: true,
    debug: { registered: true, lastPrevented: true },
  });
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isEditorActive())).toBe(true);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState())).toEqual({
    name: "Untitled",
    dirty: true,
  });

  const invalidLoadChooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("Load", { exact: true }).click();
  const invalidLoadChooser = await invalidLoadChooserPromise;
  await invalidLoadChooser.setFiles({
    name: "invalid-level.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        name: "must-not-replace-current-document",
        created: "2026-07-19T00:00:00.000Z",
        modified: "2026-07-19T00:00:00.000Z",
        spawnPoint: { position: [0, 2, 0] },
        objects: [
          {
            id: "unsupported-object",
            name: "Unsupported",
            parentId: null,
            source: { type: "sprite" },
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            physics: { type: "static" },
          },
        ],
      }),
    ),
  });
  await expect(page.locator(".ke-save-error")).toHaveText(
    "Load rejected — one or more objects or hierarchy links could not be reconstructed.",
  );
  await expect(page.locator(".ke-save-error")).toBeVisible();
  expect(await page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(initialObjectCount + 1);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState())).toEqual({
    name: "Untitled",
    dirty: true,
  });
  await page.screenshot({ path: "docs/audits/evidence/28-editor-dirty.png" });

  let downloadCount = 0;
  page.on("download", () => {
    downloadCount++;
  });
  page.once("dialog", (dialog) => void dialog.accept("trust-flow"));
  const firstDownloadPromise = page.waitForEvent("download");
  await page.locator(".ke-tree-row").last().click();
  await page.locator(".ke-inspector input").first().focus();
  await page.keyboard.press("Control+S");
  const firstDownload = await firstDownloadPromise;
  expect(firstDownload.suggestedFilename()).toBe("trust-flow.json");
  await expect(page.locator(".ke-dirty-dot")).toBeHidden();
  await expect(page.locator(".ke-document-title")).toHaveText("trust-flow");
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState())).toEqual({
    name: "trust-flow",
    dirty: false,
  });
  expect(await page.evaluate(() => window.__KINEMA__.getEditorUnloadProtectionState().registered)).toBe(false);
  const firstSave = await page.evaluate(() => {
    const index = JSON.parse(localStorage.getItem("kinema_level_index") ?? "[]") as Array<{
      key: string;
      name: string;
    }>;
    const entry = index.find((candidate) => candidate.name === "trust-flow");
    return entry ? localStorage.getItem(entry.key) : null;
  });
  expect(firstSave).not.toBeNull();
  const firstCreated = JSON.parse(firstSave as string).created as string;
  const saveEventsAfterFirstSave = await page.evaluate(() => window.__KINEMA__.getEditorSaveEventCount());

  await placeBlock(page);
  await expect(page.locator(".ke-dirty-dot")).toBeVisible();
  let cancelDialogs = 0;
  const cancelOverwrite = (dialog: import("@playwright/test").Dialog): void => {
    cancelDialogs++;
    if (cancelDialogs === 1) void dialog.accept("trust-flow");
    else void dialog.dismiss();
  };
  page.on("dialog", cancelOverwrite);
  await page.keyboard.press("Control+S");
  await expect.poll(() => cancelDialogs).toBe(2);
  page.off("dialog", cancelOverwrite);
  await page.waitForTimeout(250);
  expect(downloadCount).toBe(1);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorSaveEventCount())).toBe(saveEventsAfterFirstSave);
  expect(
    await page.evaluate(() => {
      const index = JSON.parse(localStorage.getItem("kinema_level_index") ?? "[]") as Array<{
        key: string;
        name: string;
      }>;
      const entry = index.find((candidate) => candidate.name === "trust-flow");
      return entry ? localStorage.getItem(entry.key) : null;
    }),
  ).toBe(firstSave);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState().dirty)).toBe(true);

  let acceptDialogs = 0;
  const acceptOverwrite = (dialog: import("@playwright/test").Dialog): void => {
    acceptDialogs++;
    void dialog.accept("trust-flow");
  };
  page.on("dialog", acceptOverwrite);
  const overwriteDownloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Control+S");
  await overwriteDownloadPromise;
  await expect.poll(() => acceptDialogs).toBe(2);
  page.off("dialog", acceptOverwrite);
  await expect(page.locator(".ke-dirty-dot")).toBeHidden();
  expect(await page.evaluate(() => window.__KINEMA__.getEditorSaveEventCount())).toBe(saveEventsAfterFirstSave + 1);
  expect(
    await page.evaluate(() => {
      const index = JSON.parse(localStorage.getItem("kinema_level_index") ?? "[]") as Array<{
        key: string;
        name: string;
      }>;
      const entry = index.find((candidate) => candidate.name === "trust-flow");
      const stored = entry ? localStorage.getItem(entry.key) : null;
      return stored ? (JSON.parse(stored).created as string) : null;
    }),
  ).toBe(firstCreated);

  await placeBlock(page);
  await expect(page.locator(".ke-dirty-dot")).toBeVisible();
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    const testWindow = window as Window & { __kinemaOriginalSetItem?: typeof originalSetItem };
    testWindow.__kinemaOriginalSetItem = originalSetItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
      if (key.startsWith("kinema_level_")) throw new DOMException("quota", "QuotaExceededError");
      originalSetItem.call(this, key, value);
    };
  });
  let quotaDialogs = 0;
  const acceptQuotaSave = (dialog: import("@playwright/test").Dialog): void => {
    quotaDialogs++;
    void dialog.accept("trust-flow");
  };
  page.on("dialog", acceptQuotaSave);
  const failedDownloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Control+S");
  await failedDownloadPromise;
  await expect.poll(() => quotaDialogs).toBe(2);
  page.off("dialog", acceptQuotaSave);
  await expect(page.locator(".ke-save-error")).toHaveText(
    "Save failed — storage full. A file download was started instead.",
  );
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState().dirty)).toBe(true);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorUnloadProtectionState().registered)).toBe(true);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorSaveEventCount())).toBe(saveEventsAfterFirstSave + 1);
  await page.evaluate(() => {
    const testWindow = window as Window & { __kinemaOriginalSetItem?: typeof Storage.prototype.setItem };
    if (testWindow.__kinemaOriginalSetItem) {
      Storage.prototype.setItem = testWindow.__kinemaOriginalSetItem;
      delete testWindow.__kinemaOriginalSetItem;
    }
  });

  let releaseDelayedAsset!: () => void;
  let confirmDelayedRequest!: () => void;
  const delayedRequest = new Promise<void>((resolve) => {
    confirmDelayedRequest = resolve;
  });
  const releaseAsset = new Promise<void>((resolve) => {
    releaseDelayedAsset = resolve;
  });
  await page.route("**/assets/models/kin021-delayed.glb", async (route) => {
    confirmDelayedRequest();
    await releaseAsset;
    await route.fulfill({
      path: path.resolve(
        "public/assets/models/Universal Animation Library 2[Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb",
      ),
    });
  });

  const validLoadChooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("Load", { exact: true }).click();
  const validLoadChooser = await validLoadChooserPromise;
  await validLoadChooser.setFiles({
    name: "authored-sentinel-level.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        name: "procedural",
        created: "2026-07-19T00:00:00.000Z",
        modified: "2026-07-19T00:00:00.000Z",
        spawnPoint: { position: [0, 2, 0] },
        objects: [
          {
            id: "delayed-glb",
            name: "Delayed GLB",
            parentId: null,
            source: { type: "glb", asset: "/assets/models/kin021-delayed.glb" },
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          },
        ],
      }),
    ),
  });
  await delayedRequest;

  const objectCountDuringLoad = await page.evaluate(() => window.__KINEMA__.getEditorObjectCount());
  await page.keyboard.press("Control+Z");
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(objectCountDuringLoad);
  await page.getByTitle("Load", { exact: true }).click();
  await expect(page.locator(".ke-save-error")).toHaveText(
    "Load already in progress — wait for it to finish before editing or loading another level.",
  );
  releaseDelayedAsset();

  await expect(page.locator(".ke-document-title")).toHaveText("procedural", { timeout: 60_000 });
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState())).toEqual({
    name: "procedural",
    dirty: false,
  });
  expect(await page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(1);
  await expect(page.locator(".ke-save-error")).toBeHidden();
});

test("rejects stale async editor lifecycle completions", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem("kinema.user-settings.v1", JSON.stringify({ graphicsProfile: "performance" }));
  });
  await page.goto("/?station=steps", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await waitForGrounded(page);
  await openEditor(page);

  // Hold the first FileReader completion after selection. The load lifecycle must
  // already be exclusive while parsing, and a later external document must win.
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __kinemaReleaseFileRead?: () => void };
    const nativeReadAsText = FileReader.prototype.readAsText;
    FileReader.prototype.readAsText = function (blob: Blob, encoding?: string): void {
      testWindow.__kinemaReleaseFileRead = () => {
        FileReader.prototype.readAsText = nativeReadAsText;
        nativeReadAsText.call(this, blob, encoding);
      };
    };
  });
  const staleFileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("Load", { exact: true }).click();
  const staleFileChooser = await staleFileChooserPromise;
  await staleFileChooser.setFiles({
    name: "stale-file-reader-level.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        name: "stale-file-reader",
        created: "2026-07-19T00:00:00.000Z",
        modified: "2026-07-19T00:00:00.000Z",
        spawnPoint: { position: [0, 2, 0] },
        objects: [],
      }),
    ),
  });
  await expect(page.locator(".ke-toolbar")).toHaveAttribute("aria-busy", "true");
  await page.evaluate(async () => {
    await (
      window.__KINEMA__ as typeof window.__KINEMA__ & {
        loadExternalEditorLevel(name: string): Promise<void>;
      }
    ).loadExternalEditorLevel("external-after-file-read");
  });
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __kinemaReleaseFileRead?: () => void };
    testWindow.__kinemaReleaseFileRead?.();
  });
  await openEditor(page);
  await expect(page.locator(".ke-document-title")).toHaveText("external-after-file-read");
  expect(await page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(0);

  // Pause a real GLTFLoader request. A scene transition deactivates the tool and
  // invalidates its captured editor generation before the request completes.
  let releaseImport!: () => void;
  let confirmImportRequest!: () => void;
  const importRequested = new Promise<void>((resolve) => {
    confirmImportRequest = resolve;
  });
  const importReleased = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  await page.route("**/assets/models/kin021-import-race.glb", async (route) => {
    confirmImportRequest();
    await importReleased;
    await route.fulfill({
      path: path.resolve(
        "public/assets/models/Universal Animation Library 2[Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb",
      ),
    });
  });
  await page.evaluate(() => {
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    let useControlledUrl = true;
    URL.createObjectURL = (value: Blob | MediaSource): string => {
      if (useControlledUrl) {
        useControlledUrl = false;
        return "/assets/models/kin021-import-race.glb";
      }
      return nativeCreateObjectURL(value);
    };
  });
  const importChooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("Import GLB").click();
  const importChooser = await importChooserPromise;
  await importChooser.setFiles(
    path.resolve(
      "public/assets/models/Universal Animation Library 2[Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb",
    ),
  );
  await importRequested;
  await page.evaluate(async () => {
    await (
      window.__KINEMA__ as typeof window.__KINEMA__ & {
        loadExternalEditorLevel(name: string): Promise<void>;
      }
    ).loadExternalEditorLevel("external-after-import");
  });
  releaseImport();
  await openEditor(page);
  await expect(page.locator(".ke-document-title")).toHaveText("external-after-import");
  await expect(page.locator(".ke-session-import-notice")).toBeHidden();
  expect(await page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(0);

  // Load a document with a GLB, evict its cache, and pause the play-test restore
  // on the same real request. The external level must supersede restore without
  // dirty recovery, editor:loaded emission, or re-entering the stale document.
  let restoreRequestCount = 0;
  let releaseRestore!: () => void;
  let confirmRestoreRequest!: () => void;
  const restoreRequested = new Promise<void>((resolve) => {
    confirmRestoreRequest = resolve;
  });
  const restoreReleased = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  await page.route("**/assets/models/kin021-restore-race.glb", async (route) => {
    restoreRequestCount++;
    if (restoreRequestCount > 1) {
      confirmRestoreRequest();
      await restoreReleased;
    }
    await route.fulfill({
      path: path.resolve(
        "public/assets/models/Universal Animation Library 2[Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb",
      ),
    });
  });
  const restoreLevelChooserPromise = page.waitForEvent("filechooser");
  await page.getByTitle("Load", { exact: true }).click();
  const restoreLevelChooser = await restoreLevelChooserPromise;
  await restoreLevelChooser.setFiles({
    name: "restore-race-level.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        name: "restore-race-source",
        created: "2026-07-19T00:00:00.000Z",
        modified: "2026-07-19T00:00:00.000Z",
        spawnPoint: { position: [0, 2, 0] },
        objects: [
          {
            id: "restore-glb",
            name: "Restore GLB",
            parentId: null,
            source: { type: "glb", asset: "/assets/models/kin021-restore-race.glb" },
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            physics: { type: "static" },
          },
        ],
      }),
    ),
  });
  await expect(page.locator(".ke-document-title")).toHaveText("restore-race-source", { timeout: 60_000 });
  await page.evaluate(() => window.__KINEMA__.startPlayTest());
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(true);
  await page.evaluate(() => {
    (
      window.__KINEMA__ as typeof window.__KINEMA__ & {
        evictEditorAsset(assetPath: string): void;
      }
    ).evictEditorAsset("/assets/models/kin021-restore-race.glb");
    const testWindow = window as typeof window & { __kinemaRestorePromise?: Promise<void> };
    testWindow.__kinemaRestorePromise = window.__KINEMA__.stopPlayTest();
  });
  await restoreRequested;
  await page.evaluate(async () => {
    await (
      window.__KINEMA__ as typeof window.__KINEMA__ & {
        loadExternalEditorLevel(name: string): Promise<void>;
      }
    ).loadExternalEditorLevel("external-after-restore");
  });
  releaseRestore();
  await page.evaluate(async () => {
    const testWindow = window as typeof window & { __kinemaRestorePromise?: Promise<void> };
    await testWindow.__kinemaRestorePromise;
  });
  await openEditor(page);
  await expect(page.locator(".ke-document-title")).toHaveText("external-after-restore");
  expect(await page.evaluate(() => window.__KINEMA__.getEditorDocumentState())).toEqual({
    name: "external-after-restore",
    dirty: false,
  });
  expect(await page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(0);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorUnloadProtectionState().registered)).toBe(false);
});

test("play-test cannot survive a main-menu transition and soft-brick the next run", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem("kinema.user-settings.v1", JSON.stringify({ graphicsProfile: "performance" }));
    Object.defineProperty(HTMLCanvasElement.prototype, "requestPointerLock", {
      configurable: true,
      value: undefined,
    });
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await startProceduralRun(page);
  await openEditor(page);

  const initialObjectCount = await page.evaluate(() => window.__KINEMA__.getEditorObjectCount());
  await placeBlock(page);
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(initialObjectCount + 1);
  await expect(page.locator(".ke-tree-row-selected")).toHaveCount(1);

  await page.evaluate(() => window.__KINEMA__.startPlayTest());
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(true);
  await expect(page.locator(".ke-playtest-bar")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Main Menu", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Main Menu", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Kinema", exact: true })).toBeVisible();
  await expect(page.locator(".menu-screen.active")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Resume", exact: true }).locator("..")).not.toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(false);
  await expect(page.locator(".ke-playtest-bar")).toHaveCount(0);

  await startProceduralRun(page);
  await expect(page.locator(".ke-playtest-bar")).toHaveCount(0);
  expect(await page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(false);

  await page.keyboard.press("F1");
  await page.waitForFunction(() => window.__KINEMA__.isEditorActive(), undefined, { timeout: 60_000 });
  await expect(page.locator(".ke-toolbar")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("editor-reopened-second-run.png") });

  const secondRunObjectCount = await page.evaluate(() => window.__KINEMA__.getEditorObjectCount());
  const cameraBeforeStop = await page.evaluate(() => window.__KINEMA__.getCameraPose());
  await page.evaluate(() => window.__KINEMA__.startPlayTest());
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isPlayTesting())).toBe(true);
  await page.evaluate(() => window.__KINEMA__.stopPlayTest());
  await expect.poll(() => page.evaluate(() => window.__KINEMA__.isEditorActive())).toBe(true);
  expect(await page.evaluate(() => window.__KINEMA__.getEditorObjectCount())).toBe(secondRunObjectCount);
  expect(await page.evaluate(() => window.__KINEMA__.getCameraPose())).toEqual(cameraBeforeStop);
  await expect(page.locator(".ke-playtest-bar")).toHaveCount(0);
  await expect(page.locator(".ke-tree-row-selected")).toHaveCount(0);
  await expect(page.getByText("No selection", { exact: true })).toBeVisible();

  const realErrors = errors.filter((message) => !message.includes("favicon") && !message.includes("404"));
  expect(realErrors).toEqual([]);
});

test("storage quota failure shows a persistent editor error without emitting save success", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem("kinema.user-settings.v1", JSON.stringify({ graphicsProfile: "performance" }));
  });
  await page.goto("/?station=steps", { waitUntil: "domcontentloaded" });
  await waitForKinema(page);
  await waitForGrounded(page);
  await openEditor(page);

  const saveEventsBefore = await page.evaluate(() => window.__KINEMA__.getEditorSaveEventCount());
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    const testWindow = window as Window & { __kinemaOriginalSetItem?: typeof originalSetItem };
    testWindow.__kinemaOriginalSetItem = originalSetItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string): void {
      if (key.startsWith("kinema_level_")) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      originalSetItem.call(this, key, value);
    };
  });

  page.once("dialog", (dialog) => void dialog.accept("quota-test"));
  const failedDownloadPromise = page.waitForEvent("download");
  await page.locator('button[title="Save (Ctrl+S)"]').click();
  const failedDownload = await failedDownloadPromise;
  expect(failedDownload.suggestedFilename()).toBe("quota-test.json");

  const errorToast = page.locator(".ke-save-error");
  await expect(errorToast).toHaveText("Save failed — storage full. A file download was started instead.");
  await expect(errorToast).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(errorToast).toBeVisible();
  expect(await page.evaluate(() => window.__KINEMA__.getEditorSaveEventCount())).toBe(saveEventsBefore);
  await page.screenshot({ path: testInfo.outputPath("editor-save-quota-error.png") });

  await page.evaluate(() => {
    const testWindow = window as Window & { __kinemaOriginalSetItem?: typeof Storage.prototype.setItem };
    if (testWindow.__kinemaOriginalSetItem) {
      Storage.prototype.setItem = testWindow.__kinemaOriginalSetItem;
      delete testWindow.__kinemaOriginalSetItem;
    }
  });
  page.once("dialog", (dialog) => void dialog.accept("saved-after-recovery"));
  const successfulDownloadPromise = page.waitForEvent("download");
  await page.locator('button[title="Save (Ctrl+S)"]').click();
  await successfulDownloadPromise;
  await expect(errorToast).toBeHidden();
  expect(await page.evaluate(() => window.__KINEMA__.getEditorSaveEventCount())).toBe(saveEventsBefore + 1);
});
