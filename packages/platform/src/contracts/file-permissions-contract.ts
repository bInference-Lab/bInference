import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContractCheck } from "@binference/core/testing";
import type { FilePermissions } from "../ports.js";

/** An adapter under test, with an empty scratch folder of its own. */
export interface FilePermissionsSubject {
  readonly permissions: FilePermissions;
  readonly folder: string;
}

/** Makes subjects, and judges a path with the OS's own tools. */
export interface FilePermissionsHarness {
  create(): Promise<FilePermissionsSubject>;
  /** What lets someone other than the owner reach the path, in the OS's terms; empty when nothing does. */
  accessProblems(path: string): Promise<readonly string[]>;
}

const signal = (): AbortSignal => new AbortController().signal;

/** The contract every `FilePermissions` adapter passes. */
export function filePermissionsContract(harness: FilePermissionsHarness): readonly ContractCheck[] {
  return [
    {
      name: "restricts a file others could read, and the owner still reads it",
      run: async () => {
        const { permissions, folder } = await harness.create();
        const file = join(folder, "shared.txt");
        await writeFile(file, "secret", { mode: 0o644 });
        await permissions.restrictFile(file, signal());
        assert.deepEqual(await harness.accessProblems(file), []);
        assert.equal(await readFile(file, "utf8"), "secret");
      },
    },
    {
      name: "restricts a folder, and the owner still writes in it",
      run: async () => {
        const { permissions, folder } = await harness.create();
        const inner = join(folder, "keys");
        await mkdir(inner, { mode: 0o755 });
        await permissions.restrictFolder(inner, signal());
        await writeFile(join(inner, "agent-key"), "key");
        assert.deepEqual(await harness.accessProblems(inner), []);
      },
    },
    {
      name: "fails with a code for a path that does not exist",
      run: async () => {
        const { permissions, folder } = await harness.create();
        await assert.rejects(permissions.restrictFile(join(folder, "missing"), signal()), {
          code: "platform.restrict_failed",
        });
      },
    },
    {
      name: "does nothing on an aborted signal",
      run: async () => {
        const { permissions, folder } = await harness.create();
        const reason = new Error("stopped");
        await assert.rejects(permissions.restrictFolder(folder, AbortSignal.abort(reason)), reason);
      },
    },
  ];
}
