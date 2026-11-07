import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf } from "../testing/agent-tool-fixtures.js";

const page = {
  kind: "text",
  path: "/srv/workspace/plan.md",
  text: "one\ntwo",
  startLine: 1,
  endLine: 2,
  totalLines: 2,
};
const refused = (code: `${string}.${string}`) => new BinferenceError({ code, message: "Refused." });

describe("the file tools", () => {
  it("read a page of a file, and say where to go on", async () => {
    const whole = callTool({ "file/read": page }, { name: "file_read", args: { path: "plan.md" } });
    expect(await outcomeOf(whole)).toStrictEqual({ text: "one\ntwo", isError: false });
    expect(whole.client.calls()).toStrictEqual([
      { op: "file/read", args: { agent, path: "plan.md" } },
    ]);
    const more = { ...page, totalLines: 5, next: { offset: 3, cutBy: "lines" } };
    expect(
      (
        await outcomeOf(
          callTool({ "file/read": more }, { name: "file_read", args: { path: "plan.md" } }),
        )
      ).text,
    ).toBe("one\ntwo\n\n[3 more lines in file. Use offset=3 to continue.]");
    const capped = { ...page, totalLines: 5, next: { offset: 3, cutBy: "bytes" } };
    expect(
      (
        await outcomeOf(
          callTool({ "file/read": capped }, { name: "file_read", args: { path: "a" } }),
        )
      ).text,
    ).toMatch(/\[Read output capped at 10 KB for this call\. Use offset=3 to continue\.\]$/);
    const empty = { ...page, text: "", endLine: 0, totalLines: 0 };
    expect(
      (
        await outcomeOf(
          callTool({ "file/read": empty }, { name: "file_read", args: { path: "a" } }),
        )
      ).text,
    ).toBe("The file is empty.");
  });

  it("describe an image file through the image view", async () => {
    const run = callTool(
      {
        "file/read": { kind: "image", path: "/srv/chart.png" },
        "image/view": { contentType: "image/png", bytes: 4, offset: 0, data: "iVBORw==" },
      },
      { name: "file_read", args: { path: "~/chart.png" } },
    );
    expect(await outcomeOf(run)).toStrictEqual({ text: "A price chart.", isError: false });
    expect(run.client.calls()[1]).toStrictEqual({
      op: "image/view",
      args: { agent, path: "/srv/chart.png" },
    });
  });

  it("write, edit and patch files, and say what changed", async () => {
    const write = callTool(
      { "file/write": { path: "/srv/workspace/a.md", changed: true, bytes: 3 } },
      { name: "file_write", args: { path: "a.md", content: "abc" } },
    );
    expect((await outcomeOf(write)).text).toBe(
      "Successfully wrote 3 bytes to /srv/workspace/a.md.",
    );
    const edit = callTool(
      { "file/edit": { path: "/srv/a.md", changed: true, bytes: 3, replaced: 2 } },
      { name: "file_edit", args: { path: "a.md", edits: [{ oldText: "a", newText: "b" }] } },
    );
    expect((await outcomeOf(edit)).text).toBe("Successfully replaced 2 block(s) in /srv/a.md.");
    const same = callTool(
      { "file/edit": { path: "/srv/a.md", changed: false, bytes: 3, replaced: 0 } },
      { name: "file_edit", args: { path: "a.md", edits: [{ oldText: "a", newText: "a" }] } },
    );
    expect((await outcomeOf(same)).text).toMatch(/^No changes made to \/srv\/a\.md\./);
    const patch = callTool(
      {
        "file/patch": {
          files: [
            { path: "/w/a.md", change: "added" },
            { path: "/w/b.md", change: "moved", to: "/w/c.md" },
          ],
        },
      },
      { name: "file_patch", args: { input: "*** Begin Patch\n*** End Patch" } },
    );
    expect((await outcomeOf(patch)).text).toBe(
      "Success. Changed files:\nA /w/a.md\nR /w/b.md -> /w/c.md",
    );
    const failed = callTool(
      {
        "file/patch": {
          files: [],
          problem: "The patch changed nothing: a.md: there is no such file.",
        },
      },
      { name: "file_patch", args: { input: "x" } },
    );
    expect(await outcomeOf(failed)).toStrictEqual({
      text: "The patch changed nothing: a.md: there is no such file.",
      isError: true,
    });
  });

  it("show the engine's problem when an edit cannot be placed, as outside content", async () => {
    const problem =
      "The edit: its old text is not in the file.\nClosest lines in the file:\nline 1 (90% alike): a = 1";
    const run = callTool(
      { "file/edit": { path: "/srv/a.md", changed: false, bytes: 5, problem } },
      { name: "file_edit", args: { path: "a.md", oldText: "a = 2", newText: "a = 3" } },
    );
    expect(await outcomeOf(run)).toStrictEqual({ text: problem, isError: true, outside: true });
    expect(run.client.calls()[0]?.args).toStrictEqual({
      agent,
      path: "a.md",
      edits: [{ oldText: "a = 2", newText: "a = 3" }],
    });
    const none = await outcomeOf(callTool({}, { name: "file_edit", args: { path: "a.md" } }));
    expect(none.isError).toBe(true);
  });

  it("say how many lines a file has when the offset is past its end, and go on inside a long line", async () => {
    const past = { ...page, text: "", startLine: 9, endLine: 2, totalLines: 2 };
    expect(
      (
        await outcomeOf(
          callTool({ "file/read": past }, { name: "file_read", args: { path: "a", offset: 9 } }),
        )
      ).text,
    ).toBe(
      "Offset 9 is past the end of the file (2 lines in all). Read again with an offset of 2 or less.",
    );
    const long = {
      ...page,
      totalLines: 2,
      endLine: 1,
      next: { offset: 1, cursor: 10_240, cutBy: "bytes" },
    };
    expect(
      (await outcomeOf(callTool({ "file/read": long }, { name: "file_read", args: { path: "a" } })))
        .text,
    ).toMatch(/Use offset=1 cursor=10240 to continue\.\]$/);
  });

  it("say when a write or a patch changes nothing", async () => {
    const same = callTool(
      { "file/write": { path: "/w/a.md", changed: false, bytes: 1 } },
      { name: "file_write", args: { path: "a.md", content: "x" } },
    );
    expect((await outcomeOf(same)).text).toBe(
      "No changes made to /w/a.md; it already holds this content.",
    );
    const patch = callTool(
      { "file/patch": { files: [] } },
      { name: "file_patch", args: { input: "x" } },
    );
    expect((await outcomeOf(patch)).text).toBe(
      "No changes made: the patch leaves every file as it was.",
    );
  });

  it.each<[`${string}.${string}`, string]>([
    ["file.walled", "walled off"],
    ["file.outside_workspace", "files.workspaceOnly"],
    ["file.is_folder", "is a folder"],
  ])("tell the model why the engine refused with %s", async (code, words) => {
    const outcome = await outcomeOf(
      callTool(
        { "file/write": refused(code) },
        { name: "file_write", args: { path: "a", content: "" } },
      ),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain(words);
  });
});
