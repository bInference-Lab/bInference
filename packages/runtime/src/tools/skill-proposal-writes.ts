import type { ArgsOf, ResultOf, SkillProposalView } from "@binference/protocol";
import type { ToolOutcome } from "../loop/turn-records.js";
import type { SkillProposalToolArgs } from "./skill-proposal-args.schema.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** The tool's name, as every answer names it. */
export const skillProposalToolName = "skill_proposal";

/**
 * The answer to a proposal from a chat that holds outside content (decision 0408): every later
 * turn of that chat starts marked, so only a new chat can propose.
 */
export const outsideProposalRefusal: string =
  "Refused: this chat holds outside content, so a skill written in it might carry its words. Tell the owner what you would propose, and that they can send /clear to start a new chat and ask you again.";

// The engine's refusals of a proposal, in words that say what to do next.
const refusals: Readonly<Record<string, string>> = {
  "skill.outside_content": outsideProposalRefusal,
  "skill.name_taken":
    "Refused: a skill or a pending proposal already has that name. Pick another name, or change the existing skill with update or patch.",
  "skill.changed":
    "Refused: the skill changed since you read it, or it waits for the owner. Read it again with action read and use the revision it gives.",
  "skill.not_editable":
    "Refused: only your own workspace skills take a proposed change; a bundled or installed skill does not. Propose a new skill under another name instead.",
  "skill.not_found":
    "Refused: you have no skill of that name. List your skills in the index, or create one.",
  "skill.patch_unmatched":
    "Refused: oldText must appear exactly once in SKILL.md. Read the skill again and give a longer, exact passage.",
  "skill.proposal_limit":
    "Refused: 20 of your proposals already wait for the owner. Tell the owner, and propose more once they applied or rejected some.",
  "skill.proposal_not_found":
    "Refused: you have no proposal with that id. List them with action list.",
  "skill.proposal_done":
    "Refused: the owner already applied or rejected that proposal, or it went stale. Make a new one.",
  "skill.invalid":
    "Refused: the skill's frontmatter would not read with this change. Keep its name and give a one-line description.",
};

/** What the owner's review needs said, after a proposal is made or revised. */
function proposedText(view: SkillProposalView, verb: string): string {
  const head = `Proposal ${view.proposal} ${verb}: ${view.kind} of skill "${view.name}", pending. The owner reviews it and applies or rejects it; nothing loads before that, and the skill index shows it once applied.`;
  if (view.findings.length === 0) {
    return `${head} Tell the owner in a line; do not repeat the skill's text.`;
  }
  const found = view.findings.map(({ file, line, code }) => `${file}:${String(line)} ${code}`);
  return `${head} Its scan found: ${found.join("; ")}. The owner cannot apply it as it stands: revise it with action revise to remove each, or tell the owner why not.`;
}

// The support files and the line on why, as both proposal calls take them.
function extrasOf(
  args: SkillProposalToolArgs,
): Pick<ArgsOf<"skillProposal/create">, "files" | "purpose"> {
  const files = args.supportFiles?.map(({ path, content }) => ({ path, text: content }));
  return {
    ...(files === undefined ? {} : { files }),
    ...(args.reason === undefined ? {} : { purpose: args.reason }),
  };
}

function missing(action: string, fields: string): ToolOutcome {
  return { text: `${skillProposalToolName} ${action} needs ${fields}.`, isError: true };
}

type CreateArgs = ArgsOf<"skillProposal/create">;

// The args of a new skill, or the fields it lacks.
function newSkillArgs(
  parts: AgentToolParts,
  args: SkillProposalToolArgs,
): CreateArgs | ToolOutcome {
  const { name, description, body } = args;
  return name === undefined || description === undefined || body === undefined
    ? missing("create", "name, description and body")
    : { agent: parts.agent, ...extrasOf(args), kind: "create", name, description, body };
}

// The args of a change to a workspace skill at the revision read gave, or the fields it lacks.
function changeArgs(parts: AgentToolParts, args: SkillProposalToolArgs): CreateArgs | ToolOutcome {
  const { name, revision, body, oldText, newText } = args;
  if (name === undefined || revision === undefined) {
    return missing(args.action, "name and the revision action read gave");
  }
  const said = args.description === undefined ? {} : { description: args.description };
  const same = { agent: parts.agent, ...extrasOf(args), ...said, name, revision };
  if (args.action === "update") {
    return body === undefined ? missing("update", "body") : { ...same, kind: "update", body };
  }
  return oldText === undefined || newText === undefined
    ? missing("patch", "oldText and newText")
    : { ...same, kind: "patch", find: oldText, replace: newText };
}

// The args of `skillProposal/create` for one action, or the fields it lacks.
function createArgsOf(
  parts: AgentToolParts,
  args: SkillProposalToolArgs,
): CreateArgs | ToolOutcome {
  return args.action === "create" ? newSkillArgs(parts, args) : changeArgs(parts, args);
}

function isOutcome(value: object): value is ToolOutcome {
  return "isError" in value;
}

async function sent(
  parts: AgentToolParts,
  work: () => Promise<ResultOf<"skillProposal/create">>,
  verb: string,
): Promise<ToolOutcome> {
  return answerOrRefusal({ tool: skillProposalToolName, refusals }, async () => {
    const { proposal } = await work();
    return { text: proposedText(proposal, verb), isError: false };
  });
}

/** Proposes a new skill, a whole new body, or one exact replacement. */
export async function proposeSkill(
  parts: AgentToolParts,
  args: SkillProposalToolArgs,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const request = createArgsOf(parts, args);
  if (isOutcome(request)) {
    return request;
  }
  return sent(
    parts,
    async () => parts.client.call("skillProposal/create", request, { signal }),
    "made",
  );
}

/** Revises a pending proposal of the agent: its body, its description or its support files. */
export async function reviseProposal(
  parts: AgentToolParts,
  args: SkillProposalToolArgs,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const { proposal, description, body } = args;
  if (
    proposal === undefined ||
    (description ?? body ?? args.supportFiles ?? args.reason) === undefined
  ) {
    return missing(
      "revise",
      "proposal and at least one of description, body, supportFiles and reason",
    );
  }
  const request = {
    agent: parts.agent,
    proposal,
    ...(description === undefined ? {} : { description }),
    ...(body === undefined ? {} : { body }),
    ...extrasOf(args),
  };
  return sent(
    parts,
    async () => parts.client.call("skillProposal/revise", request, { signal }),
    "revised",
  );
}
