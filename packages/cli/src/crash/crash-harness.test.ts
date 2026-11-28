import { join } from "node:path";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { storyOnFailure } from "./crash-harness.js";

const folders: TempFolder[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// A run's folder whose engine logged this line.
async function folderLogging(line: string): Promise<TempFolder> {
  const folder = await createTempFolder("bnf-story-");
  folders.push(folder);
  const logs = join(folder.path, "logs");
  const options = { permissions: noPermissions, signal: AbortSignal.timeout(10_000) };
  await ensurePrivateFolder(logs, options);
  await writePrivateFile(join(logs, "engine.log"), `${line}\n`, options);
  return folder;
}

describe("a crash run's story", () => {
  it("is written with the engine log before a failure inside the run goes on", async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const run = { folders: [await folderLogging("executor.read_failed")], engines: [] };
    const timedOut = new DOMException("intent/get timed out.", "TimeoutError");
    const failing = storyOnFailure(run, async () => Promise.reject(timedOut));
    await expect(failing).rejects.toBe(timedOut);
    expect(written.join("")).toContain("executor.read_failed");
  });

  it("is not written when the run passes", async () => {
    const write = vi.spyOn(process.stderr, "write");
    const run = { folders: [await folderLogging("engine.ready")], engines: [] };
    await expect(storyOnFailure(run, async () => Promise.resolve("settled"))).resolves.toBe(
      "settled",
    );
    expect(write).not.toHaveBeenCalled();
  });
});
