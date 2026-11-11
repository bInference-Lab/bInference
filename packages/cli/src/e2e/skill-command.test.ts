import { testNowMs } from "@binference/engine/testing";
import type { ProtocolId } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import {
  type ReviewRig,
  reviewRig,
  rigAgent,
  writeWorkspaceSkill,
} from "../skill-review/review-rig.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const rigs: ReviewRig[] = [];
const [composition] = skeletonCompositions;

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await Promise.all(rigs.splice(0).map(async (rig) => rig.folder.remove()));
  await machines.removeAll();
});

const newSkill = {
  agent: rigAgent,
  kind: "create",
  name: "dip-buyer",
  description: "Buys a listed token after a fall.",
  body: "1. Check the token's risk.\n",
  purpose: "You asked me to remember how you buy dips.",
} as const;

// A machine whose engine answers the skill operations from a rig with a pending proposal and,
// once the shelf first read its skills, a workspace skill written after it that waits.
async function servedWithSkills(): Promise<{
  readonly machine: TestMachine;
  readonly rig: ReviewRig;
  readonly proposal: ProtocolId<"skillProposal">;
}> {
  if (composition === undefined) {
    throw new Error("No composition.");
  }
  const rig = await reviewRig(["mine"]);
  rigs.push(rig);
  const { proposal } = await rig.call("skillProposal/create", newSkill);
  await writeWorkspaceSkill(rig, "planted");
  const machine = await machines.create(testNowMs);
  served.push(await serveSkeleton(machine, composition, { handlers: rig.handlers }));
  return { machine, rig, proposal: proposal.proposal };
}

describe("binference skill", () => {
  it("lists the pending proposals and the waiting skills, and shows one whole", slow, async () => {
    const { machine, proposal } = await servedWithSkills();
    const listed = await runOn(machine, ["skill", "proposals"]);
    expect([listed.code, listed.stderr]).toStrictEqual([0, ""]);
    expect(listed.stdout).toContain(
      `${proposal}: new skill "dip-buyer", pending: Buys a listed token after a fall.`,
    );
    expect(listed.stdout).toContain('"planted" at workspace/planted/SKILL.md');
    const shown = await runOn(machine, ["skill", "show", proposal]);
    expect(shown.stdout).toContain(
      'New skill "dip-buyer" (pending): Buys a listed token after a fall.',
    );
    expect(shown.stdout).toContain("Why: You asked me to remember how you buy dips.");
    expect(shown.stdout).toContain("+ 1. Check the token's risk.");
  });

  it("applies only with a yes, and accepts a waiting skill at its hash", slow, async () => {
    const { machine, rig, proposal } = await servedWithSkills();
    const unasked = await runOn(machine, ["skill", "apply", proposal]);
    expect(unasked.code).toBe(1);
    expect(unasked.stderr).toContain("Applying waits for your yes.");
    const applied = await runOn(machine, ["skill", "apply", proposal, "--yes"]);
    expect([applied.code, applied.stderr]).toStrictEqual([0, ""]);
    expect(applied.stdout).toContain("Applied. dip-buyer loads from the agent's next turn.");
    const accepted = await runOn(machine, ["skill", "accept", "planted", "--yes"]);
    expect(accepted.stdout).toContain("Accepted. planted loads from the agent's next turn.");
    const loaded = (await rig.shelf.list(rigAgent, AbortSignal.timeout(10_000))).map(
      ({ name }) => name,
    );
    expect(loaded).toStrictEqual(["dip-buyer", "mine", "planted", "safe-swap"]);
  });

  it("rejects with the owner's reason", slow, async () => {
    const { machine, rig, proposal } = await servedWithSkills();
    const rejected = await runOn(machine, ["skill", "reject", proposal, "--reason", "Not now."]);
    expect([rejected.code, rejected.stdout]).toStrictEqual([0, "Rejected. Nothing changed.\n"]);
    const view = await rig.call("skillProposal/get", { proposal });
    expect(view).toMatchObject({ status: "rejected", reason: "Not now." });
  });
});
