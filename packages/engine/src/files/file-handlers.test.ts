import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testPng } from "../chat/test-images.js";
import { createMemoryFiles, memoryFilePlaces } from "../fakes/memory-files.js";
import { testAgent } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { createFileHandlers } from "./file-handlers.js";
import type { FileSettings } from "./file-records.js";
import type { MachineFiles } from "./ports.js";

const { workspace, home } = memoryFilePlaces;
const open: FileSettings = { workspaceOnly: false, patchWorkspaceOnly: true };

// A call of the agent runtime for the test agent.
const call = <Args extends object>(args: Args) =>
  testCall({ agent: testAgent, ...args }, testCallers.runtime);

function setUp(files: MachineFiles, settings: FileSettings = open) {
  const handlers = createFileHandlers({ files, settings: () => settings });
  return {
    read: async (args: {
      readonly path: string;
      readonly offset?: number;
      readonly limit?: number;
      readonly cursor?: number;
    }) => handlers["file/read"](call(args)),
    write: async (path: string, content: string) => handlers["file/write"](call({ path, content })),
    edit: async (
      path: string,
      edits: readonly { readonly oldText: string; readonly newText: string }[],
    ) => handlers["file/edit"](call({ path, edits })),
    patch: async (input: string) => handlers["file/patch"](call({ input })),
  };
}

describe("the file handlers", () => {
  it("write a file and read a page of it back, by its absolute path", async () => {
    const files = setUp(createMemoryFiles());
    expect(await files.write("plan.md", "one\ntwo\nthree\n")).toStrictEqual({
      ok: true,
      value: { path: `${workspace}/plan.md`, changed: true, bytes: 14 },
    });
    expect(await files.read({ path: "plan.md", offset: 2, limit: 1 })).toStrictEqual({
      ok: true,
      value: {
        kind: "text",
        path: `${workspace}/plan.md`,
        text: "two",
        startLine: 2,
        endLine: 2,
        totalLines: 3,
        next: { offset: 3, cutBy: "lines" },
      },
    });
  });

  it("name an image file for the image tools, and refuse a binary file", async () => {
    const machine = createMemoryFiles();
    await machine.write("~/chart.png", testPng, {
      signal: new AbortController().signal,
      workspaceOnly: false,
    });
    await machine.write("~/blob.bin", new Uint8Array([1, 0, 2]), {
      signal: new AbortController().signal,
      workspaceOnly: false,
    });
    const files = setUp(machine);
    expect(await files.read({ path: "~/chart.png" })).toStrictEqual({
      ok: true,
      value: { kind: "image", path: `${home}/chart.png` },
    });
    expect(await files.read({ path: "~/blob.bin" })).toStrictEqual({
      ok: false,
      error: "file.binary",
    });
    expect(await files.edit("~/blob.bin", [{ oldText: "a", newText: "b" }])).toStrictEqual({
      ok: false,
      error: "file.binary",
    });
  });

  it("edit a file in place, and say when nothing changed", async () => {
    const files = setUp(createMemoryFiles({ [`${home}/a.txt`]: "a = 1\n" }));
    expect(await files.edit("~/a.txt", [{ oldText: "1", newText: "2" }])).toStrictEqual({
      ok: true,
      value: { path: `${home}/a.txt`, changed: true, bytes: 6, replaced: 1 },
    });
    expect(await files.read({ path: "~/a.txt" })).toMatchObject({
      ok: true,
      value: { text: "a = 2" },
    });
    expect(await files.edit("~/a.txt", [{ oldText: "2", newText: "2" }])).toStrictEqual({
      ok: true,
      value: { path: `${home}/a.txt`, changed: false, bytes: 6, replaced: 0 },
    });
    expect(await files.edit("~/a.txt", [{ oldText: "zz", newText: "y" }])).toMatchObject({
      ok: true,
      value: {
        path: `${home}/a.txt`,
        changed: false,
        problem: expect.stringContaining("its old text is not in the file") as string,
      },
    });
  });

  it("refuse binference's folder, and stay in the workspace as the owner's settings say", async () => {
    const machine = createMemoryFiles({ [`${home}/notes.md`]: "x\n" });
    const loose = setUp(machine);
    expect(await loose.read({ path: "~/.binference/config.json5" })).toStrictEqual({
      ok: false,
      error: "file.walled",
    });
    expect(await loose.write("~/.binference/keys/x", "y")).toStrictEqual({
      ok: false,
      error: "file.walled",
    });
    expect(await loose.edit("~/missing.md", [{ oldText: "a", newText: "b" }])).toStrictEqual({
      ok: false,
      error: "file.not_found",
    });
    expect(
      await loose.patch("*** Begin Patch\n*** Delete File: ~/notes.md\n*** End Patch"),
    ).toMatchObject({
      ok: true,
      value: {
        files: [],
        problem:
          "The patch changed nothing: ~/notes.md: it is outside the agent's workspace, where patches stay.",
      },
    });
    const shut = setUp(machine, { workspaceOnly: true, patchWorkspaceOnly: true });
    expect(await shut.read({ path: "~/notes.md" })).toStrictEqual({
      ok: false,
      error: "file.outside_workspace",
    });
    expect(await shut.write("~/notes.md", "y")).toStrictEqual({
      ok: false,
      error: "file.outside_workspace",
    });
  });

  it("run a patch and answer what it did", async () => {
    const files = setUp(createMemoryFiles());
    expect(
      await files.patch("*** Begin Patch\n*** Add File: todo.md\n+- chart\n*** End Patch"),
    ).toStrictEqual({
      ok: true,
      value: { files: [{ path: `${workspace}/todo.md`, change: "added" }] },
    });
  });

  it("refuse every call on an engine with no files", async () => {
    const handlers = createFileHandlers(undefined);
    expect(await handlers["file/read"](call({ path: "a.md" }))).toStrictEqual({
      ok: false,
      error: "file.unreadable",
    });
  });

  it("refuse an edit whose write fails", async () => {
    const memory = createMemoryFiles({ [`${home}/a.txt`]: "a\n" });
    const files = setUp({ ...memory, write: async () => Promise.resolve(err("unwritable")) });
    expect(await files.edit("~/a.txt", [{ oldText: "a", newText: "b" }])).toStrictEqual({
      ok: false,
      error: "file.unwritable",
    });
    expect(await files.write("~/b.txt", "b")).toStrictEqual({
      ok: false,
      error: "file.unwritable",
    });
  });

  it("read a UTF-16 file as text, and answer a write that changes nothing as unchanged", async () => {
    const machine = createMemoryFiles();
    const utf16 = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    await machine.write("~/w.txt", utf16, {
      signal: new AbortController().signal,
      workspaceOnly: false,
    });
    const files = setUp(machine);
    expect(await files.read({ path: "~/w.txt" })).toMatchObject({
      ok: true,
      value: { text: "hi" },
    });
    await files.write("same.md", "x");
    expect(await files.write("same.md", "x")).toStrictEqual({
      ok: true,
      value: { path: `${workspace}/same.md`, changed: false, bytes: 1 },
    });
  });

  it("refuse a write the file does not hold when read back", async () => {
    const memory = createMemoryFiles();
    const files = setUp({
      ...memory,
      write: async (path, _bytes, options) => memory.write(path, new Uint8Array([0x2a]), options),
    });
    expect(await files.write("a.md", "abc")).toStrictEqual({ ok: false, error: "file.unwritable" });
  });

  it("keep a patch in the workspace when only workspaceOnly is on", async () => {
    const files = setUp(createMemoryFiles({ [`${home}/n.md`]: "x\n" }), {
      workspaceOnly: true,
      patchWorkspaceOnly: false,
    });
    expect(
      await files.patch("*** Begin Patch\n*** Delete File: ~/n.md\n*** End Patch"),
    ).toMatchObject({
      ok: true,
      value: {
        files: [],
        problem: expect.stringContaining("outside the agent's workspace") as string,
      },
    });
  });

  it("go on inside a line longer than a page from the cursor the last page gave", async () => {
    const files = setUp(createMemoryFiles());
    await files.write("long.txt", `${"a".repeat(12_000)}\nend\n`);
    expect(await files.read({ path: "long.txt" })).toMatchObject({
      ok: true,
      value: { next: { offset: 1, cursor: 10_240, cutBy: "bytes" } },
    });
    const second = await files.read({ path: "long.txt", offset: 1, cursor: 10_240 });
    expect(second).toMatchObject({ ok: true, value: { startLine: 1 } });
  });
});
