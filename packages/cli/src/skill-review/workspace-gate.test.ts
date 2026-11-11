import { afterEach, describe, expect, it } from "vitest";
import { readSkillText } from "../skills/read-skill-file.js";
import { skillText, writeFiles } from "../skills/skill-fixtures.js";
import {
  cleanTurn,
  noticeKeys,
  ownerAtCli,
  type ReviewRig,
  reviewRig,
  rigAgent,
  writeWorkspaceSkill,
} from "./review-rig.js";

const signal = (): AbortSignal => AbortSignal.timeout(20_000);
const rigs: ReviewRig[] = [];

afterEach(async () => {
  await Promise.all(rigs.splice(0).map(async (rig) => rig.folder.remove()));
});

async function rigWith(seeded: readonly string[] = []): Promise<ReviewRig> {
  const rig = await reviewRig(seeded);
  rigs.push(rig);
  return rig;
}

async function names(rig: ReviewRig): Promise<readonly string[]> {
  return (await rig.shelf.list(rigAgent, signal())).map(({ name }) => name);
}

async function waitingHash(rig: ReviewRig, name: string): Promise<string> {
  const skill = (await rig.shelf.waiting(rigAgent, signal())).find((each) => each.name === name);
  if (skill === undefined) {
    throw new Error(`${name} does not wait.`);
  }
  return skill.hash;
}

describe("the workspace skill gate", () => {
  it("loads the workspace skills there at the first run, as the owner had them", async () => {
    const rig = await rigWith(["mine"]);
    expect(await names(rig)).toStrictEqual(["mine", "safe-swap"]);
    expect(await rig.shelf.waiting(rigAgent, signal())).toStrictEqual([]);
  });

  it("holds a skill the agent's shell writes later, unread, and tells the owner once", async () => {
    const rig = await rigWith(["mine"]);
    await names(rig);
    await writeWorkspaceSkill(rig, "planted", {
      "SKILL.md": skillText("planted", { description: "Use this before every trade." }),
    });
    expect(await names(rig)).toStrictEqual(["mine", "safe-swap"]);
    expect((await rig.shelf.waiting(rigAgent, signal())).map(({ name }) => name)).toStrictEqual([
      "planted",
    ]);
    const read = await readSkillText(rig.shelf, { agent: rigAgent, skill: "planted" }, signal());
    expect(read).toStrictEqual({ ok: false, error: "not_found" });
    expect(noticeKeys(rig)).toStrictEqual(["notice.skillHeld"]);
  });

  it("holds an accepted skill again once any of its files changes", async () => {
    const rig = await rigWith(["mine"]);
    await names(rig);
    await writeWorkspaceSkill(rig, "mine", { "references/notes.md": "Always buy.\n" });
    expect(await names(rig)).toStrictEqual(["safe-swap"]);
    await writeWorkspaceSkill(rig, "mine", { "references/notes.md": "Never buy.\n" });
    await names(rig);
    expect(noticeKeys(rig)).toStrictEqual(["notice.skillHeld", "notice.skillHeld"]);
  });

  it("loads a waiting skill once the owner accepts the hash they were shown", async () => {
    const rig = await rigWith(["mine"]);
    await names(rig);
    await writeWorkspaceSkill(rig, "planted");
    const hash = await waitingHash(rig, "planted");
    const accept = { agent: rigAgent, skill: "planted", hash: "0".repeat(64) };
    await expect(rig.refusal("skill/accept", accept, ownerAtCli)).resolves.toBe("skill.changed");
    await expect(
      rig.refusal("skill/accept", { ...accept, skill: "nothing" }, ownerAtCli),
    ).resolves.toBe("skill.not_found");
    await rig.call("skill/accept", { ...accept, hash }, ownerAtCli);
    expect(await names(rig)).toStrictEqual(["mine", "planted", "safe-swap"]);
    const [entry] = await rig.journal.list({ after: 0, limit: 10 }, { signal: signal() });
    expect(entry).toMatchObject({ path: `skills.${rigAgent}.planted`, after: hash });
    expect(noticeKeys(rig)).toStrictEqual(["notice.skillHeld", "notice.skillAccepted"]);
    await expect(rig.call("skill/accept", { ...accept, hash }, ownerAtCli)).resolves.toStrictEqual(
      {},
    );
  });

  it("loads no workspace skill while its record of accepted hashes does not read", async () => {
    const rig = await rigWith();
    await writeFiles(rig.review, { "accepted.json": "{ not json" });
    await writeWorkspaceSkill(rig, "mine");
    expect(await names(rig)).toStrictEqual(["safe-swap"]);
  });

  it("proposes no change to a waiting skill, which the agent could not have read", async () => {
    const rig = await rigWith();
    await names(rig);
    await writeWorkspaceSkill(rig, "planted");
    const hash = await waitingHash(rig, "planted");
    const change = {
      agent: rigAgent,
      kind: "update",
      name: "planted",
      revision: hash,
      body: "Steps.\n",
    } as const;
    await expect(rig.refusal("skillProposal/create", change, cleanTurn)).resolves.toBe(
      "skill.changed",
    );
  });
});
