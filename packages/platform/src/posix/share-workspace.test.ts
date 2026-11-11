import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempFolder, type TempFolder } from "../fakes/temp-folder.js";
import { shareWorkspace } from "./share-workspace.js";

const folders: TempFolder[] = [];
const never = new AbortController().signal;

async function scratch(): Promise<string> {
  const folder = await createTempFolder("bnf-share-");
  folders.push(folder);
  return folder.path;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// The test can give a folder only a group its own process holds: its own.
const ownGroup = process.getgid?.() ?? 0;

describe.skipIf(process.platform === "win32")("sharing the image's workspace", () => {
  it("gives an owner-only workspace the group and mode both users write it with", async () => {
    const workspace = join(await scratch(), "workspace");
    mkdirSync(workspace, { mode: 0o700 });
    writeFileSync(join(workspace, "kept.txt"), "kept", { mode: 0o600 });

    await shareWorkspace(workspace, ownGroup, never);

    const shared = statSync(workspace);
    expect(shared.mode & 0o777).toBe(0o770);
    expect(shared.gid).toBe(ownGroup);
    // Only the folder changes, never what it holds.
    expect(statSync(join(workspace, "kept.txt")).mode & 0o777).toBe(0o600);
  });

  it("makes a workspace that is not there", async () => {
    const workspace = join(await scratch(), "workspace");

    await shareWorkspace(workspace, ownGroup, never);

    expect(statSync(workspace).mode & 0o777).toBe(0o770);
  });

  it("says which folder it could not share", async () => {
    const file = join(await scratch(), "file");
    writeFileSync(file, "not a folder");

    await expect(shareWorkspace(join(file, "workspace"), ownGroup, never)).rejects.toMatchObject({
      code: "platform.share_failed",
      details: { path: join(file, "workspace") },
    });
  });
});
