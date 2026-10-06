import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@binference/core";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { acquireFileLock, type FileLock } from "./file-lock.js";
import { resolveStateFolder } from "./state-folder.js";

// A second process that holds the engine lock the way a running engine does, until it is killed.
const holder = `
import { DatabaseSync } from "node:sqlite";
const database = new DatabaseSync(process.argv[1], { timeout: 0 });
database.exec("BEGIN EXCLUSIVE");
process.stdout.write("held\\n");
setInterval(() => {}, 60_000);
`;

const folders: string[] = [];

function lockOf(result: Result<FileLock, "held">): FileLock {
  if (!result.ok) {
    throw new Error(`Expected the lock, got ${result.error}.`);
  }
  return result.value;
}

async function stateFolder() {
  const folder = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(folder);
  return resolveStateFolder({ binferenceHome: folder });
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

describe("file lock", () => {
  it("refuses a second engine lock on the same state folder", async () => {
    const { engineLock } = await stateFolder();

    const first = lockOf(acquireFileLock(engineLock));
    const second = acquireFileLock(engineLock);

    expect(second).toStrictEqual({ ok: false, error: "held" });
    first.release();
  });

  it("gives the lock to the next engine once the first releases it", async () => {
    const { engineLock } = await stateFolder();
    const first = lockOf(acquireFileLock(engineLock));
    first.release();
    first.release();

    const next = acquireFileLock(engineLock);

    expect(next.ok).toBe(true);
    lockOf(next).release();
  });

  it("refuses the lock while another process holds it, and frees it when that process dies", async () => {
    const { engineLock } = await stateFolder();
    const child = execa(process.execPath, ["--input-type=module", "-e", holder, engineLock], {
      cancelSignal: AbortSignal.timeout(30_000),
      buffer: false,
    });
    const ready = new Promise<string>((resolve) => {
      child.stdout.once("data", (chunk: Buffer) => {
        resolve(String(chunk));
      });
    });
    await expect(ready).resolves.toBe("held\n");

    expect(acquireFileLock(engineLock)).toStrictEqual({ ok: false, error: "held" });

    child.kill("SIGKILL");
    await expect(child).rejects.toMatchObject({ isTerminated: true });
    lockOf(acquireFileLock(engineLock)).release();
  });

  it("names the fault when the lock file cannot be opened", () => {
    expect(() => acquireFileLock(join(tmpdir(), "bnf-missing", "deeper", "engine.lock"))).toThrow(
      expect.objectContaining({ code: "platform.lock_failed" }),
    );
  });
});
