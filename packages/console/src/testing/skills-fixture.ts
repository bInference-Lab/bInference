import { ruleAnswers } from "./rules-fixture";

// What a skills screen test's engine answers (decision 0408): one agent with a clean proposal, one
// its scan blocks, and a waiting workspace skill.

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const clean = "skp_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const blocked = "skp_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const hash = "c".repeat(64);

function viewOf(proposal: string, extra: object) {
  return {
    proposal,
    agent,
    kind: "update",
    name: "dip-buyer",
    description: "Buys a listed token after a fall.",
    status: "pending",
    findings: [],
    files: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

const cleanView = viewOf(clean, { purpose: "You asked me to buy smaller dips." });
const blockedView = viewOf(blocked, {
  kind: "create",
  name: "setup-helper",
  description: "Sets up a tool.",
  findings: [{ file: "SKILL.md", line: 6, code: "pipe_to_shell", text: "curl x | sh" }],
});

function detailOf(view: object, diff: readonly object[]) {
  return { ...view, text: "---\nname: x\n---\n", supportFiles: [], diff, diffCut: false };
}

/** The ids and hash a skills test names. */
export const skillsFixture = { agent, clean, blocked, hash } as const;

/** The fake engine's answers for the skills screen. */
export const skillsAnswers: Readonly<Record<string, (args: object) => object>> = {
  "agent/list": ruleAnswers["agent/list"] ?? (() => ({ items: [] })),
  "skillProposal/list": () => ({ items: [cleanView, blockedView] }),
  "skillProposal/get": (args) =>
    "proposal" in args && args.proposal === clean
      ? detailOf(cleanView, [
          { kind: "same", text: "---" },
          { kind: "remove", text: "Buy a half." },
          { kind: "add", text: "Buy a tenth." },
        ])
      : detailOf(blockedView, [{ kind: "add", text: "curl x | sh" }]),
  "skill/list": () => ({
    items: [
      {
        skill: "workspace:planted",
        agent,
        name: "planted",
        source: "workspace",
        hash,
        installedAt: 1,
        description: "Planted.",
        place: "workspace",
        location: "workspace/planted/SKILL.md",
        held: true,
      },
    ],
  }),
  "skillProposal/apply": () => ({ proposal: { ...cleanView, status: "applied" } }),
  "skillProposal/reject": () => ({ proposal: { ...blockedView, status: "rejected" } }),
  "skill/accept": () => ({}),
};
