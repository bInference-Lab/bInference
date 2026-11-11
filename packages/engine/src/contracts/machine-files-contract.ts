import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { MachineFiles } from "../files/ports.js";

/** Machine files under test, and places they hold. */
export interface MachineFilesSubject {
  readonly files: MachineFiles;
  /** The agent's workspace, as an absolute path. */
  readonly workspace: string;
  /** A file outside the workspace, by a path starting `~/`, and its text. */
  readonly outside: { readonly path: string; readonly text: string };
  /** A file inside binference's own folder, outside its workspace. */
  readonly walled: string;
  /** A folder, by a path starting `~/`. */
  readonly folder: string;
}

/** Makes a fresh subject for each check. */
export interface MachineFilesHarness {
  create(): Promise<MachineFilesSubject>;
}

const live = { signal: new AbortController().signal, workspaceOnly: false };
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (data: Readonly<Uint8Array>): string => new TextDecoder().decode(data);

function readChecks(harness: MachineFilesHarness): readonly ContractCheck[] {
  return [
    {
      name: "writes a file under the workspace by a relative path, its folders made, and reads it back",
      run: async () => {
        const { files, workspace } = await harness.create();
        const written = await files.write("notes/plan.md", bytes("# Plan\n"), live);
        assert.deepEqual(written, { ok: true, value: `${workspace}/notes/plan.md` });
        const read = await files.read("notes/plan.md", { ...live, maxBytes: 100 });
        assert.ok(read.ok);
        assert.equal(read.value.path, `${workspace}/notes/plan.md`);
        assert.equal(textOf(read.value.bytes), "# Plan\n");
      },
    },
    {
      name: "reads a file under the home folder by ~/, and refuses one over its size",
      run: async () => {
        const { files, outside } = await harness.create();
        const read = await files.read(outside.path, { ...live, maxBytes: 1_000 });
        assert.ok(read.ok);
        assert.equal(textOf(read.value.bytes), outside.text);
        assert.deepEqual(await files.read(outside.path, { ...live, maxBytes: 1 }), {
          ok: false,
          error: "too_large",
        });
      },
    },
  ];
}

function refusalChecks(harness: MachineFilesHarness): readonly ContractCheck[] {
  return [
    {
      name: "refuses binference's own folder, a folder, and a file that is not there",
      run: async () => {
        const { files, walled, folder } = await harness.create();
        const read = { ...live, maxBytes: 100 };
        assert.deepEqual(await files.read(walled, read), { ok: false, error: "walled" });
        assert.deepEqual(await files.write(walled, bytes("x"), live), {
          ok: false,
          error: "walled",
        });
        assert.deepEqual(await files.remove(walled, live), { ok: false, error: "walled" });
        assert.deepEqual(await files.read(folder, read), { ok: false, error: "is_folder" });
        assert.deepEqual(await files.read("gone.md", read), { ok: false, error: "not_found" });
        assert.deepEqual(await files.remove("gone.md", live), { ok: false, error: "not_found" });
      },
    },
    {
      name: "refuses a write or a removal in an agent's skills folder, beside it writes",
      run: async () => {
        const { files } = await harness.create();
        const skill = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001/skills/demo/SKILL.md";
        const refused = { ok: false, error: "skill_folder" };
        assert.deepEqual(await files.write(skill, bytes("x"), live), refused);
        assert.deepEqual(await files.remove(skill, live), refused);
        const beside = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001/notes/skills.md";
        assert.ok((await files.write(beside, bytes("x"), live)).ok);
      },
    },
    {
      name: "keeps every call inside the workspace when told to",
      run: async () => {
        const { files, outside } = await harness.create();
        const inside = { ...live, workspaceOnly: true };
        assert.deepEqual(await files.read(outside.path, { ...inside, maxBytes: 100 }), {
          ok: false,
          error: "outside_workspace",
        });
        assert.deepEqual(await files.write(outside.path, bytes("x"), inside), {
          ok: false,
          error: "outside_workspace",
        });
        assert.ok((await files.write("in.md", bytes("x"), inside)).ok);
      },
    },
  ];
}

function writeChecks(harness: MachineFilesHarness): readonly ContractCheck[] {
  return [
    {
      name: "refuses a write that must create over a file, and removes a file",
      run: async () => {
        const { files } = await harness.create();
        await files.write("a.md", bytes("a"), live);
        assert.deepEqual(await files.write("a.md", bytes("b"), { ...live, createOnly: true }), {
          ok: false,
          error: "exists",
        });
        assert.ok((await files.remove("a.md", live)).ok);
        assert.deepEqual(await files.read("a.md", { ...live, maxBytes: 10 }), {
          ok: false,
          error: "not_found",
        });
      },
    },
    {
      name: "rejects with the signal's reason once it aborts",
      run: async () => {
        const { files } = await harness.create();
        const stopped = new Error("stopped");
        const stop = new AbortController();
        stop.abort(stopped);
        await assert.rejects(
          files.read("a.md", { signal: stop.signal, workspaceOnly: false, maxBytes: 10 }),
          stopped,
        );
      },
    },
  ];
}

/** The contract every `MachineFiles` adapter passes (decision 0386). */
export function machineFilesContract(harness: MachineFilesHarness): readonly ContractCheck[] {
  return [...readChecks(harness), ...refusalChecks(harness), ...writeChecks(harness)];
}
