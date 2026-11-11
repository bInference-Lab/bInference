// oxlint-disable-next-line eslint/no-restricted-imports -- this test plants links in its own folder
import { rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { listFolderFiles } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { writeFiles } from "./skill-fixtures.js";
import { readSkillBytes, skillFolderUnder } from "./skill-folder.js";

const signal = (): AbortSignal => AbortSignal.timeout(10_000);
const state: { folder?: TempFolder } = {};

// A workspace with one skill holding a support file, and a secret outside it.
async function workspace() {
  const folder = await createTempFolder("bnf-skill-folder-");
  state.folder = folder;
  const root = join(folder.path, "workspace");
  await writeFiles(root, { "agt/skills/demo/references/steps.md": "Steps." });
  await writeFiles(folder.path, { "secret.txt": "the owner's secret" });
  const skill = await skillFolderUnder(root, join("agt", "skills", "demo"), signal());
  return { root, secret: join(folder.path, "secret.txt"), skill };
}

afterEach(async () => {
  await state.folder?.remove();
});

describe("a skill's folder", () => {
  it("reads a file inside the folder", async () => {
    const { skill } = await workspace();
    expect(
      await readSkillBytes(skill, "references/steps.md", { maxBytes: 100, signal: signal() }),
    ).toStrictEqual({ ok: true, value: new TextEncoder().encode("Steps.") });
  });

  it("reads nothing of a support file that became a link once the folder was listed", async () => {
    const { secret, skill } = await workspace();
    const [listed = ""] = await listFolderFiles(skill.folder, signal());
    await rm(join(skill.folder, listed));
    await symlink(secret, join(skill.folder, listed));
    expect(await readSkillBytes(skill, listed, { maxBytes: 100, signal: signal() })).toStrictEqual({
      ok: false,
      error: "changed",
    });
  });

  it("reads nothing once a folder above the skill became a link", async () => {
    const { root, skill } = await workspace();
    await writeFiles(join(root, "..", "elsewhere"), { "demo/references/steps.md": "planted" });
    await rename(join(root, "agt", "skills"), join(root, "agt", "moved"));
    await symlink(join(root, "..", "elsewhere"), join(root, "agt", "skills"));
    expect(
      await readSkillBytes(skill, "references/steps.md", { maxBytes: 100, signal: signal() }),
    ).toStrictEqual({ ok: false, error: "changed" });
  });
});
