import type { SkillProposalOperationShapes } from "../operations/skill-proposal-operations.schema.js";
import { ids, pageOf, type WireExample, type WireObject } from "./wire-values.js";

const description = "Buys a listed token after a fall, in small steps.";

const proposal: WireObject = {
  proposal: ids.skillProposal,
  agent: ids.agent,
  kind: "create",
  name: "dip-buyer",
  description,
  status: "pending",
  findings: [],
  files: ["references/sizes.md"],
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000,
};

const body = "1. Check the token's risk.\n";
const text = `---\nname: dip-buyer\ndescription: ${description}\n---\n\n${body}`;
const files = [{ path: "references/sizes.md", text: "Start at a tenth of the per-trade cap.\n" }];
const decided = { decidedAt: 1_760_000_200_000 };

/** Example calls of the skill proposal operations (decision 0408). */
export const skillProposalExamples: {
  readonly [N in keyof SkillProposalOperationShapes]: WireExample;
} = {
  "skillProposal/create": {
    args: { agent: ids.agent, kind: "create", name: "dip-buyer", description, body, files },
    result: { proposal },
  },
  "skillProposal/revise": {
    args: { agent: ids.agent, proposal: ids.skillProposal, body },
    result: { proposal: { ...proposal, updatedAt: 1_760_000_100_000 } },
  },
  "skillProposal/list": {
    args: { agent: ids.agent, status: "pending", limit: 20 },
    result: pageOf(proposal),
  },
  "skillProposal/get": {
    args: { proposal: ids.skillProposal },
    result: {
      ...proposal,
      text,
      supportFiles: files,
      diff: [
        { kind: "add", text: "---" },
        { kind: "add", text: "name: dip-buyer" },
      ],
      diffCut: true,
    },
  },
  "skillProposal/apply": {
    args: { proposal: ids.skillProposal },
    result: { proposal: { ...proposal, status: "applied", ...decided } },
  },
  "skillProposal/reject": {
    args: { proposal: ids.skillProposal, reason: "Keep the sizes in the strategy." },
    result: {
      proposal: {
        ...proposal,
        status: "rejected",
        ...decided,
        reason: "Keep the sizes in the strategy.",
      },
    },
  },
};
