import { dirname, join } from "node:path";
import { idSchema } from "@binference/core";
import {
  type FilePermissions,
  listFolderFiles,
  movePath,
  readTextFile,
  realFilePath,
} from "@binference/platform";
import { createFileLink, createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { skillText, writeFiles } from "../skills/skill-fixtures.js";
import { skillFolderHash } from "../skills/skill-folder-hash.js";
import { skillFolderUnder } from "../skills/skill-folder.js";
import { applyProposal } from "./apply-proposal.js";
import type { ProposalRecord } from "./proposal-record.js";

const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const signal = (): AbortSignal => AbortSignal.timeout(10_000);
const state: { folder?: TempFolder } = {};

afterEach(async () => {
  await state.folder?.remove();
});

// A state folder holding a key, and the agent's own workspace skill named `keys`, as the folder
// of the key is named, with a change proposed on it.
async function machine() {
  const folder = await createTempFolder("bnf-apply-");
  state.folder = folder;
  const root = join(await realFilePath(folder.path, signal()), "state");
  const workspace = join(root, "workspace");
  const skills = join(workspace, agent, "skills");
  await writeFiles(root, { "keys/agent-key": "secret" });
  await writeFiles(skills, { "keys/SKILL.md": skillText("keys") });
  const hash = await skillFolderHash(
    await skillFolderUnder(workspace, join(agent, "skills", "keys"), signal()),
    signal(),
  );
  const record: ProposalRecord = {
    proposal: idSchema("skp").parse("skp_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
    agent,
    kind: "update",
    name: "keys",
    description: "Keeps notes on keys.",
    status: "pending",
    text: skillText("keys", { body: "Read the notes first." }),
    supportFiles: [],
    findings: [],
    base: { hash: String(hash), text: skillText("keys") },
    createdAt: 1,
    updatedAt: 1,
  };
  return { root, workspace, skills, record };
}

// The skills folder is made private right before the apply moves anything; at that moment it
// becomes a link to `to`, here the state folder, whose `keys` folder holds the key.
function linkingAsMadePrivate(skills: string, to: string): FilePermissions {
  return {
    ...noPermissions,
    restrictFolder: async (path) => {
      if (path === skills) {
        await movePath(skills, join(dirname(skills), "moved"), signal());
        await createFileLink(to, skills);
      }
    },
  };
}

describe("applying a skill proposal", () => {
  it("puts nothing in, and moves nothing aside, once the skills folder became a link", async () => {
    const { root, workspace, skills, record } = await machine();
    const permissions = linkingAsMadePrivate(skills, root);
    const parts = {
      workspace,
      review: join(root, "skill-review"),
      shelf: { list: async () => Promise.resolve([]), waiting: async () => Promise.resolve([]) },
      accepted: { accept: async () => Promise.resolve(undefined) },
      permissions,
      random: { bytes: (length: number) => new Uint8Array(length).fill(7) },
    };
    expect(await applyProposal(parts, record, signal())).toStrictEqual({
      ok: false,
      error: "stale",
    });
    expect(await listFolderFiles(join(root, "keys"), signal())).toStrictEqual(["agent-key"]);
    expect(await readTextFile(join(root, "keys", "agent-key"), signal())).toStrictEqual({
      ok: true,
      value: "secret",
    });
  });
});
