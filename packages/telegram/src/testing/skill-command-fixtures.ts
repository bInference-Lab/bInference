import { err, ok } from "@binference/core";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import {
  type ProtocolId,
  protocolIdSchema,
  type ResultOf,
  type SkillProposalDetail,
} from "@binference/protocol";

// The engine a `/skills` test talks to (decision 0408): one agent, a pending proposal that changes
// a workspace skill, one its scan blocks, and a waiting skill.

/** The test's agent. */
export const skillAgent: ProtocolId<"agent"> = protocolIdSchema("agent").parse(
  "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1",
);

/** The waiting skill's folder hash. */
export const waitingHash: string = "b".repeat(64);

const status: ResultOf<"engine/status"> = {
  state: "ready",
  version: "2026.11.0",
  protocol: 1,
  frozen: false,
  agents: [{ id: skillAgent, mode: "paper", frozen: false }],
  health: [],
};

function proposalOf(serial: string, change: Partial<SkillProposalDetail>): SkillProposalDetail {
  return {
    proposal: protocolIdSchema("skillProposal").parse(
      `skp_0190f1c2-3a4b-7c5d-8e6f-00000000000${serial}`,
    ),
    agent: skillAgent,
    kind: "update",
    name: "dip-buyer",
    description: "Buys a listed token after a fall.",
    status: "pending",
    findings: [],
    files: [],
    createdAt: 1,
    updatedAt: 1,
    text: "---\nname: dip-buyer\n---\n\nBuy a tenth.\n",
    supportFiles: [],
    diff: [
      { kind: "same", text: "---" },
      { kind: "remove", text: "Buy a half." },
      { kind: "add", text: "Buy a tenth." },
    ],
    diffCut: false,
    ...change,
  };
}

/** A clean change of a workspace skill, with the agent's line on why. */
export const cleanProposal: SkillProposalDetail = proposalOf("1", {
  purpose: "You asked me to buy smaller dips.",
});

/** A new skill whose scan found a download piped into a shell. */
export const blockedProposal: SkillProposalDetail = proposalOf("2", {
  kind: "create",
  name: "setup-helper",
  description: "Sets up a tool.",
  findings: [{ file: "SKILL.md", line: 6, code: "pipe_to_shell", text: "curl x | sh" }],
  diff: [{ kind: "add", text: "curl x | sh" }],
});

const skillProposals: readonly SkillProposalDetail[] = [cleanProposal, blockedProposal];

const waiting = {
  skill: "workspace:planted",
  agent: skillAgent,
  name: "planted",
  source: "workspace",
  hash: waitingHash,
  installedAt: 1,
  description: "Planted.",
  place: "workspace" as const,
  location: "workspace/planted/SKILL.md",
  held: true,
};

/** An engine that answers `/skills`'s reads and records each apply, reject and accept. */
export function skillEngine(): {
  readonly handlers: Partial<OwnerChatHandlers>;
  readonly asked: (readonly [string, string])[];
} {
  const asked: (readonly [string, string])[] = [];
  const views = skillProposals.map(
    ({ text: _text, supportFiles: _files, diff: _diff, diffCut: _cut, ...view }) => view,
  );
  const handlers: Partial<OwnerChatHandlers> = {
    "engine/status": async () => Promise.resolve(ok(status)),
    "skillProposal/list": async () => Promise.resolve(ok({ items: views })),
    "skillProposal/get": async ({ args }) => {
      const found = skillProposals.find(({ proposal }) => proposal === args.proposal);
      return Promise.resolve(found === undefined ? err("skill.proposal_not_found") : ok(found));
    },
    "skill/list": async () => Promise.resolve(ok({ items: [waiting] })),
    "skillProposal/apply": async ({ args }) => {
      asked.push(["apply", args.proposal]);
      const [view] = views;
      return Promise.resolve(
        view === undefined
          ? err("skill.proposal_not_found")
          : ok({ proposal: { ...view, status: "applied" } }),
      );
    },
    "skillProposal/reject": async ({ args }) => {
      asked.push(["reject", args.proposal]);
      return Promise.resolve(err("skill.proposal_done"));
    },
    "skill/accept": async ({ args }) => {
      asked.push(["accept", `${args.skill} ${args.hash}`]);
      return Promise.resolve(ok({}));
    },
  };
  return { handlers, asked };
}
