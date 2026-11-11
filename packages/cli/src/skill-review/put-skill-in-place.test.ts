import { dirname, join } from "node:path";
import {
  listFolderFiles,
  movePath,
  type RealPathStep,
  realFilePath,
  realPathOf,
} from "@binference/platform";
import { createFileLink, createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { skillText, writeFiles } from "../skills/skill-fixtures.js";
import { skillFolderUnder } from "../skills/skill-folder.js";
import { putSkillInPlace } from "./put-skill-in-place.js";

const signal = (): AbortSignal => AbortSignal.timeout(10_000);
const state: { folder?: TempFolder } = {};

afterEach(async () => {
  await state.folder?.remove();
});

// A state folder holding a key, an agent's skills folder in its workspace, and a built skill.
async function machine(name: string) {
  const folder = await createTempFolder("bnf-place-");
  state.folder = folder;
  const root = join(await realFilePath(folder.path, signal()), "state");
  const workspace = join(root, "workspace");
  await writeFiles(root, { "keys/agent-key": "secret" });
  await writeFiles(workspace, { "agt/skills/other/SKILL.md": skillText("other") });
  await writeFiles(root, { [`skill-review/work/apply-7/SKILL.md`]: skillText(name) });
  const target = await skillFolderUnder(workspace, join("agt", "skills", name), signal());
  const placement = {
    target,
    work: join(root, "skill-review", "work", "apply-7"),
    aside: join(root, "skill-review", "work", "old-7"),
    tag: "7",
  };
  return { root, skills: dirname(target.folder), placement };
}

// The platform's real-path step, but the skills folder becomes a link to `to` once both looks
// at it before the move have their answers.
function linkingAfterChecks(skills: string, to: string): RealPathStep {
  let looks = 0;
  return async (path, stepSignal) => {
    const real = await realPathOf(path, stepSignal);
    looks += path === skills ? 1 : 0;
    if (path === skills && looks === 2) {
      await movePath(skills, join(dirname(skills), "moved"), stepSignal);
      await createFileLink(to, skills);
    }
    return real;
  };
}

describe("putting an applied skill in place", () => {
  it("moves the built skill into the skills folder judged", async () => {
    const { skills, placement } = await machine("notes-kit");
    const options = { permissions: noPermissions, signal: signal() };
    await expect(putSkillInPlace(placement, options)).resolves.toBe(true);
    expect(await listFolderFiles(skills, signal())).toStrictEqual([
      "notes-kit/SKILL.md",
      "other/SKILL.md",
    ]);
  });

  it("takes a new skill back out of a skills folder that became a link after its checks", async () => {
    const { root, skills, placement } = await machine("notes-kit");
    const realPath = linkingAfterChecks(skills, join(root, "keys"));
    const options = { permissions: noPermissions, signal: signal(), realPath };
    await expect(putSkillInPlace(placement, options)).resolves.toBe(false);
    expect(await listFolderFiles(join(root, "keys"), signal())).toStrictEqual(["agent-key"]);
    expect(await listFolderFiles(placement.work, signal())).toStrictEqual(["SKILL.md"]);
  });

  it("moves nothing aside from a skills folder that became a link after its checks", async () => {
    const { root, skills, placement } = await machine("keys");
    const realPath = linkingAfterChecks(skills, root);
    const options = { permissions: noPermissions, signal: signal(), realPath };
    await expect(putSkillInPlace(placement, options)).resolves.toBe(false);
    expect(await listFolderFiles(join(root, "keys"), signal())).toStrictEqual(["agent-key"]);
    expect(await listFolderFiles(placement.aside, signal())).toStrictEqual([]);
  });
});
