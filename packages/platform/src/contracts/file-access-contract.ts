import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContractCheck } from "@binference/core/testing";
import type { FileAccess, FileAccessState } from "../ports.js";

/** An adapter under test, with an empty scratch folder of its own. */
export interface FileAccessSubject {
  readonly access: FileAccess;
  readonly folder: string;
}

/** Makes subjects, and says whether the adapter reads this OS's access lists. */
export interface FileAccessHarness {
  create(): Promise<FileAccessSubject>;
  /** False for an adapter that answers `unknown` for every path that exists. */
  readonly readsAccess: boolean;
}

const signal = (): AbortSignal => new AbortController().signal;

/** The contract every `FileAccess` adapter passes. */
export function fileAccessContract(harness: FileAccessHarness): readonly ContractCheck[] {
  const expected = (state: FileAccessState): FileAccessState =>
    harness.readsAccess ? state : "unknown";
  return [
    {
      name: "answers missing where nothing is",
      run: async () => {
        const { access, folder } = await harness.create();
        assert.equal(await access.read(join(folder, "missing"), signal()), "missing");
      },
    },
    {
      name: "tells a file others can read from one that is its owner's alone",
      run: async () => {
        const { access, folder } = await harness.create();
        const file = join(folder, "config.json5");
        await writeFile(file, "{}");
        await chmod(file, 0o644);
        assert.equal(await access.read(file, signal()), expected("open"));
        await chmod(file, 0o600);
        assert.equal(await access.read(file, signal()), expected("owner_only"));
      },
    },
    {
      name: "tells a folder others can open from one that is its owner's alone",
      run: async () => {
        const { access, folder } = await harness.create();
        const inner = join(folder, "keys");
        await mkdir(inner);
        await chmod(inner, 0o755);
        assert.equal(await access.read(inner, signal()), expected("open"));
        await chmod(inner, 0o700);
        assert.equal(await access.read(inner, signal()), expected("owner_only"));
      },
    },
    {
      name: "reads nothing on an aborted signal",
      run: async () => {
        const { access, folder } = await harness.create();
        const reason = new Error("stopped");
        await assert.rejects(access.read(folder, AbortSignal.abort(reason)), reason);
      },
    },
  ];
}
