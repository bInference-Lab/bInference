import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createMemoryFiles, memoryFilePlaces } from "../fakes/memory-files.js";
import { byteOrderMark } from "./byte-order-mark.js";
import { runPatch } from "./patch-run.js";
import type { MachineFiles } from "./ports.js";

const { workspace, home } = memoryFilePlaces;
const call = { signal: new AbortController().signal, workspaceOnly: true };
const patch = (...lines: readonly string[]) =>
  ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
const read = async (files: ReturnType<typeof createMemoryFiles>, path: string) => {
  const got = await files.read(path, { ...call, workspaceOnly: false, maxBytes: 1_000 });
  return got.ok ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(got.value.bytes) : got.error;
};

// Machine files whose write number `failing` is refused as unwritable.
function failingAt(memory: MachineFiles, failing: number): MachineFiles {
  let writes = 0;
  return {
    ...memory,
    write: async (path, bytes, options) => {
      writes += 1;
      return writes === failing ? err("unwritable") : memory.write(path, bytes, options);
    },
  };
}

describe("runPatch", () => {
  it("adds, updates, moves and deletes files in the patch's order", async () => {
    const files = createMemoryFiles({
      [`${workspace}/a.md`]: "one\ntwo\n",
      [`${workspace}/b.md`]: byteOrderMark + "old\n",
      [`${workspace}/gone.md`]: "x\n",
    });
    const ran = await runPatch(
      files,
      patch(
        "*** Add File: new.md",
        "+hello",
        "*** Update File: a.md",
        "@@",
        "-two",
        "+2",
        "*** Update File: b.md",
        "*** Move to: c.md",
        "@@",
        "-old",
        "+new",
        "*** Delete File: gone.md",
      ),
      call,
    );
    expect(ran).toStrictEqual({
      files: [
        { path: `${workspace}/new.md`, change: "added" },
        { path: `${workspace}/a.md`, change: "updated" },
        { path: `${workspace}/b.md`, change: "moved", to: `${workspace}/c.md` },
        { path: `${workspace}/gone.md`, change: "deleted" },
      ],
    });
    expect(await read(files, "new.md")).toBe("hello\n");
    expect(await read(files, "a.md")).toBe("one\n2\n");
    expect(await read(files, "c.md")).toBe(byteOrderMark + "new\n");
    expect(await read(files, "b.md")).toBe("not_found");
    expect(await read(files, "gone.md")).toBe("not_found");
  });

  it("changes nothing when one change cannot be placed", async () => {
    const files = createMemoryFiles({ [`${workspace}/a.md`]: "one\n" });
    const ran = await runPatch(
      files,
      patch("*** Add File: b.md", "+x", "*** Update File: a.md", "@@", "-missing", "+y"),
      call,
    );
    expect(ran.files).toStrictEqual([]);
    expect(ran.problem).toBe(
      "The patch changed nothing: change 1 of a.md: these lines are not in the file; read the file again:\nmissing.",
    );
    expect(await read(files, "b.md")).toBe("not_found");
  });

  it("lets a patch replace a file it deleted before, never one still there", async () => {
    const files = createMemoryFiles({ [`${workspace}/a.md`]: "old\n" });
    const again = await runPatch(
      files,
      patch("*** Delete File: a.md", "*** Add File: a.md", "+new"),
      call,
    );
    expect(again.problem).toBeUndefined();
    expect(await read(files, "a.md")).toBe("new\n");
    const over = await runPatch(files, patch("*** Add File: a.md", "+x"), call);
    expect(over.problem).toBe(
      "The patch changed nothing: a.md: a file is already there; delete it first in the same patch.",
    );
    const twice = await runPatch(
      files,
      patch("*** Add File: n.md", "+x", "*** Add File: n.md", "+y"),
      call,
    );
    expect(twice.problem).toMatch(/n\.md: a file is already there/);
  });

  it("keeps patches in the workspace when told to, and names what it cannot read", async () => {
    const files = createMemoryFiles({ [`${home}/notes.md`]: "x\n" });
    const outside = await runPatch(files, patch("*** Delete File: ~/notes.md"), call);
    expect(outside.problem).toBe(
      "The patch changed nothing: ~/notes.md: it is outside the agent's workspace, where patches stay.",
    );
    const missing = await runPatch(files, patch("*** Update File: none.md", "@@", "+x"), call);
    expect(missing.problem).toBe("The patch changed nothing: none.md: there is no such file.");
    const deletedTwice = await runPatch(
      files,
      patch("*** Delete File: ~/notes.md", "*** Delete File: ~/notes.md"),
      { ...call, workspaceOnly: false },
    );
    expect(deletedTwice.problem).toMatch(/there is no such file/);
    const unreadable = await runPatch(files, patch("*** Begin"), call);
    expect(unreadable.problem).toMatch(/^The patch cannot be read: /);
  });

  it("refuses a move onto a file that is there", async () => {
    const files = createMemoryFiles({ [`${workspace}/a.md`]: "x\n", [`${workspace}/b.md`]: "y\n" });
    const ran = await runPatch(
      files,
      patch("*** Update File: a.md", "*** Move to: b.md", "@@", "-x", "+z"),
      call,
    );
    expect(ran.problem).toMatch(/b\.md: a file is already there/);
  });

  it("says the files before a failed write were changed", async () => {
    const files = failingAt(createMemoryFiles(), 2);
    const ran = await runPatch(
      files,
      patch("*** Add File: a.md", "+a", "*** Add File: b.md", "+b"),
      call,
    );
    expect(ran).toStrictEqual({
      files: [],
      problem:
        "The patch stopped: b.md: the file could not be written; the files before it were changed.",
    });
    const first = await runPatch(
      failingAt(createMemoryFiles(), 1),
      patch("*** Add File: c.md", "+c"),
      call,
    );
    expect(first.problem).toBe("The patch stopped: c.md: the file could not be written.");
  });

  it("updates a file twice in one patch, adds an empty file, and refuses an add in binference's folder", async () => {
    const files = createMemoryFiles({ [`${workspace}/a.md`]: "1\n2\n" });
    const ran = await runPatch(
      files,
      patch(
        "*** Update File: a.md",
        "@@",
        "-1",
        "+one",
        "*** Update File: a.md",
        "@@",
        "-2",
        "+two",
        "*** Add File: empty.md",
      ),
      call,
    );
    expect(ran.problem).toBeUndefined();
    expect(await read(files, "a.md")).toBe("one\ntwo\n");
    expect(await read(files, "empty.md")).toBe("");
    const walled = await runPatch(files, patch("*** Add File: ~/.binference/x", "+y"), {
      ...call,
      workspaceOnly: false,
    });
    expect(walled.problem).toBe(
      "The patch changed nothing: ~/.binference/x: it is inside binference's own folder.",
    );
    const overEmpty = await runPatch(files, patch("*** Add File: empty.md", "+z"), call);
    expect(overEmpty.problem).toMatch(/empty\.md: a file is already there/);
  });

  it("writes and names no file a change leaves as it was", async () => {
    const files = createMemoryFiles({ [`${workspace}/a.md`]: "same\n" });
    const ran = await runPatch(files, patch("*** Update File: a.md", "@@", "-same", "+same"), call);
    expect(ran).toStrictEqual({ files: [] });
  });
});
