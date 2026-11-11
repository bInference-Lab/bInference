import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, context, outcomeOf, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { skillProposalTool } from "./skill-proposal-tool.js";

const proposal = "skp_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const revision = "a".repeat(64);
const view = {
  proposal,
  agent,
  kind: "create",
  name: "dip-buyer",
  description: "Buys after a fall.",
  status: "pending",
  findings: [],
  files: [],
  createdAt: 1,
  updatedAt: 1,
};
const create = {
  action: "create",
  name: "dip-buyer",
  description: "Buys after a fall.",
  body: "1. Check the risk.\n",
  supportFiles: [{ path: "references/sizes.md", content: "Small.\n" }],
};

function listed(place: string, held = false) {
  const item = {
    skill: `${place}:mine`,
    name: "mine",
    source: place,
    hash: revision,
    installedAt: 1,
    description: "Mine.",
    place,
    location: `${place}/mine/SKILL.md`,
  };
  return { items: [held ? { ...item, held: true } : item] };
}

const skillRead = (place: string) => ({
  skill: "mine",
  place,
  location: `${place}/mine/SKILL.md`,
  file: "SKILL.md",
  text: "---\nname: mine\ndescription: Mine.\n---\n\nSteps.\n",
});

// Runs one call of the tool in a turn that read outside content.
async function inMarkedTurn(tool: ReturnType<typeof skillProposalTool>, args: object) {
  const prepared = tool.prepare(JSON.stringify(args));
  if (!prepared.ready) {
    throw new Error(prepared.text);
  }
  return prepared.run({ ...context, turnState: () => ({ model: "router/main", outside: true }) });
}

describe("skill_proposal", () => {
  it.each([
    ["create", create],
    ["revise", { action: "revise", proposal, body: "x" }],
  ])(
    "refuses to %s in a turn that read outside content, before the engine",
    async (_action, args) => {
      const client = createFakeToolClient({ "skillProposal/create": { proposal: view } });
      const outcome = await inMarkedTurn(
        skillProposalTool({ agent, client, turn: toolTurn }),
        args,
      );
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toMatch(/^Refused: this chat holds outside content/);
      // A later message in the same chat stays marked, so only a new chat can propose.
      expect(outcome.text).toContain("send /clear");
      expect(client.calls()).toStrictEqual([]);
    },
  );

  it("is a control tool no helper gets", () => {
    const tool = skillProposalTool({ agent, client: createFakeToolClient({}), turn: toolTurn });
    expect(tool).toMatchObject({ kind: "control", forHelpers: false });
  });

  it("proposes a new skill for the owner to review, with its support files", async () => {
    const run = callTool(
      { "skillProposal/create": { proposal: view } },
      { name: "skill_proposal", args: create },
    );
    const outcome = await outcomeOf(run);
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toMatch(
      new RegExp(`^Proposal ${proposal} made: create of skill "dip-buyer", pending\\.`),
    );
    expect(run.client.calls()).toStrictEqual([
      {
        op: "skillProposal/create",
        args: {
          agent,
          kind: "create",
          name: "dip-buyer",
          description: "Buys after a fall.",
          body: "1. Check the risk.\n",
          files: [{ path: "references/sizes.md", text: "Small.\n" }],
        },
      },
    ]);
  });

  it("passes the agent's line on why to the owner's review, and refuses one of two lines", async () => {
    const reason = "You asked me to remember how to check gas before a swap.";
    const run = callTool(
      { "skillProposal/create": { proposal: view }, "skillProposal/revise": { proposal: view } },
      { name: "skill_proposal", args: { ...create, reason } },
    );
    await outcomeOf(run);
    expect(run.client.calls()).toMatchObject([{ args: { purpose: reason } }]);
    const revise = callTool(
      { "skillProposal/revise": { proposal: view } },
      { name: "skill_proposal", args: { action: "revise", proposal, reason: "Shorter." } },
    );
    await outcomeOf(revise);
    expect(revise.client.calls()).toStrictEqual([
      { op: "skillProposal/revise", args: { agent, proposal, purpose: "Shorter." } },
    ]);
    const twoLines = callTool(
      {},
      { name: "skill_proposal", args: { ...create, reason: "One.\nTwo." } },
    );
    expect(twoLines.refused).toContain("do not match skill_proposal's schema");
  });

  it("tells the agent the scan findings that keep the owner from applying it", async () => {
    const findings = [{ file: "SKILL.md", line: 6, code: "pipe_to_shell", text: "curl x | sh" }];
    const run = callTool(
      { "skillProposal/create": { proposal: { ...view, findings } } },
      { name: "skill_proposal", args: create },
    );
    expect((await outcomeOf(run)).text).toContain(
      "Its scan found: SKILL.md:6 pipe_to_shell. The owner cannot apply it as it stands",
    );
  });

  it("patches with the revision read gave, and asks for what a call lacks", async () => {
    const patch = {
      action: "patch",
      name: "mine",
      revision,
      oldText: "Steps.",
      newText: "More steps.",
    };
    const run = callTool(
      { "skillProposal/create": { proposal: view } },
      { name: "skill_proposal", args: patch },
    );
    await outcomeOf(run);
    expect(run.client.calls()).toMatchObject([
      { args: { kind: "patch", name: "mine", revision, find: "Steps.", replace: "More steps." } },
    ]);
    const lacking = callTool(
      {},
      { name: "skill_proposal", args: { action: "update", name: "mine" } },
    );
    await expect(outcomeOf(lacking)).resolves.toStrictEqual({
      text: "skill_proposal update needs name and the revision action read gave.",
      isError: true,
    });
  });

  it("answers the engine's refusal in words that say what to do next", async () => {
    const changed = new BinferenceError({ code: "skill.changed", message: "Changed." });
    const run = callTool(
      { "skillProposal/create": changed },
      { name: "skill_proposal", args: { action: "update", name: "mine", revision, body: "x" } },
    );
    expect((await outcomeOf(run)).text).toMatch(/^Refused: the skill changed since you read it/);
  });

  it("reads a workspace skill with its revision, and marks an installed one's text", async () => {
    const workspace = callTool(
      { "skill/list": listed("workspace"), "skill/read": skillRead("workspace") },
      { name: "skill_proposal", args: { action: "read", name: "mine" } },
    );
    const read = await outcomeOf(workspace);
    expect(read).toMatchObject({ isError: false });
    expect(read.text).toContain(`Revision ${revision}: give it to update or patch.`);
    const installed = callTool(
      { "skill/list": listed("installed"), "skill/read": skillRead("installed") },
      { name: "skill_proposal", args: { action: "read", name: "mine" } },
    );
    await expect(outcomeOf(installed)).resolves.toMatchObject({ outside: true });
  });

  it("reads no skill that waits for the owner to accept its files", async () => {
    const run = callTool(
      { "skill/list": listed("workspace", true) },
      { name: "skill_proposal", args: { action: "read", name: "mine" } },
    );
    await expect(outcomeOf(run)).resolves.toStrictEqual({
      text: "Skill mine cannot be read: it waits for the owner to accept its files.",
      isError: true,
    });
    expect(run.client.calls().map(({ op }) => op)).toStrictEqual(["skill/list"]);
  });

  it("lists the agent's proposals", async () => {
    const run = callTool(
      { "skillProposal/list": { items: [view] } },
      { name: "skill_proposal", args: { action: "list", status: "pending" } },
    );
    await expect(outcomeOf(run)).resolves.toStrictEqual({
      text: `- ${proposal}: create of "dip-buyer", pending. Buys after a fall.`,
      isError: false,
    });
    expect(run.client.calls()).toStrictEqual([
      { op: "skillProposal/list", args: { agent, status: "pending" } },
    ]);
  });
});
