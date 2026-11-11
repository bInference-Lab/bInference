import { err, ok, type Result } from "@binference/core";
import {
  type ArgsOf,
  type ProtocolErrorCode,
  type SkillProposalKind,
  skillProposalLimits,
  type SkillSupportFile,
} from "@binference/protocol";
import type { ShelfSkill } from "../skills/skill-shelf.js";
import type { ProposalRecord } from "./proposal-record.js";
import {
  bodyOf,
  changedSkillText,
  descriptionOf,
  newSkillText,
  patchedText,
  type SkillTextProblem,
} from "./skill-text.js";

/** What a proposal holds before it is scanned and stored. */
export interface ProposalDraft {
  readonly kind: SkillProposalKind;
  readonly name: string;
  readonly description: string;
  readonly text: string;
  readonly supportFiles: readonly SkillSupportFile[];
  readonly base?: { readonly hash: string; readonly text: string };
  readonly purpose?: string;
}

/** What a new proposal is judged against: the agent's skills and its pending proposals. */
export interface DraftContext {
  /** The skills the agent's index holds. */
  readonly skills: readonly ShelfSkill[];
  /** The names of its workspace skills that wait for the owner. */
  readonly waiting: ReadonlySet<string>;
  readonly pending: readonly ProposalRecord[];
  /** Reads a skill's `SKILL.md`. */
  readonly readText: (skill: ShelfSkill) => Promise<string | undefined>;
}

type CreateArgs = ArgsOf<"skillProposal/create">;
type Drafted = Result<ProposalDraft, ProtocolErrorCode>;

const encoder = new TextEncoder();

// A text the stored proposal keeps: its body within the limit of a body.
function sized(text: string): boolean {
  return encoder.encode(bodyOf(text)).byteLength <= skillProposalLimits.bodyBytes;
}

function draftOf(
  args: {
    readonly name: string;
    readonly files?: readonly SkillSupportFile[];
    readonly purpose?: string;
  },
  made: Omit<ProposalDraft, "name" | "supportFiles" | "description" | "purpose">,
): Drafted {
  const description = descriptionOf(made.text);
  if (description === undefined || !sized(made.text)) {
    return err(description === undefined ? "skill.invalid" : "protocol.bad_args");
  }
  const purpose = args.purpose === undefined ? {} : { purpose: args.purpose };
  return ok({ ...made, name: args.name, description, supportFiles: args.files ?? [], ...purpose });
}

function newDraft(args: CreateArgs, context: DraftContext): Drafted {
  const { description, body } = args;
  const extra = args.revision ?? args.find ?? args.replace;
  if (description === undefined || body === undefined || extra !== undefined) {
    return err("protocol.bad_args");
  }
  const taken =
    context.skills.some((skill) => skill.name === args.name) ||
    context.waiting.has(args.name) ||
    context.pending.some((proposal) => proposal.name === args.name && proposal.kind === "create");
  if (taken) {
    return err("skill.name_taken");
  }
  const text = newSkillText(args.name, { description, body });
  return text.ok ? draftOf(args, { kind: "create", text: text.value }) : err("skill.invalid");
}

// The workspace skill a change names, at the revision the agent read.
function targetOf(args: CreateArgs, context: DraftContext): Result<ShelfSkill, ProtocolErrorCode> {
  const skill = context.skills.find(({ name }) => name === args.name);
  if (skill === undefined) {
    return err(context.waiting.has(args.name) ? "skill.changed" : "skill.not_found");
  }
  if (skill.place !== "workspace") {
    return err("skill.not_editable");
  }
  return skill.hash === args.revision ? ok(skill) : err("skill.changed");
}

// The text the change starts from: the current one for a whole new body, else the current one
// with the replacement made, which must match exactly once.
function startOf(args: CreateArgs, current: string): Result<string, ProtocolErrorCode> {
  const { find, replace, body } = args;
  if (args.kind === "update") {
    return body === undefined || find !== undefined || replace !== undefined
      ? err("protocol.bad_args")
      : ok(current);
  }
  if (find === undefined || replace === undefined || body !== undefined) {
    return err("protocol.bad_args");
  }
  const patched = patchedText(current, { find, replace });
  return patched.ok ? patched : err("skill.patch_unmatched");
}

// The new text of a change: the whole body again, or one exact replacement.
function changedText(args: CreateArgs, current: string): Result<string, ProtocolErrorCode> {
  const start = startOf(args, current);
  if (!start.ok) {
    return start;
  }
  const text = changedSkillText(start.value, {
    name: args.name,
    ...(args.description === undefined ? {} : { description: args.description }),
    ...(args.body === undefined ? {} : { body: args.body }),
  });
  return text.ok ? text : err("skill.invalid");
}

async function changeDraft(args: CreateArgs, context: DraftContext): Promise<Drafted> {
  if (args.revision === undefined) {
    return err("protocol.bad_args");
  }
  const target = targetOf(args, context);
  if (!target.ok) {
    return target;
  }
  const current = await context.readText(target.value);
  if (current === undefined) {
    return err("skill.changed");
  }
  const text = changedText(args, current);
  if (!text.ok) {
    return text;
  }
  const base = { hash: target.value.hash, text: current };
  return draftOf(args, { kind: "update", text: text.value, base });
}

/**
 * The draft of a new skill proposal (decision 0408): `create` takes a free name, a description
 * and a body; `update` and `patch` name a workspace skill of the agent at the revision it read and
 * give a body, or a text that `SKILL.md` holds exactly once with its replacement. It answers the
 * code of what it refuses.
 */
export async function draftProposal(args: CreateArgs, context: DraftContext): Promise<Drafted> {
  return args.kind === "create" ? newDraft(args, context) : changeDraft(args, context);
}

// The `SKILL.md` a revision leaves: its new body and description over the ones the proposal holds.
function revisedText(
  record: ProposalRecord,
  args: ArgsOf<"skillProposal/revise">,
): Result<string, SkillTextProblem> {
  if (record.kind === "create") {
    const description = args.description ?? record.description;
    return newSkillText(record.name, { description, body: args.body ?? bodyOf(record.text) });
  }
  return changedSkillText(record.text, {
    name: record.name,
    ...(args.description === undefined ? {} : { description: args.description }),
    ...(args.body === undefined ? {} : { body: args.body }),
  });
}

/**
 * The draft of a pending proposal revised: a new body, description or support files in place of
 * the ones it holds, each kept when the revision leaves it out.
 */
export function revisedDraft(
  record: ProposalRecord,
  args: ArgsOf<"skillProposal/revise">,
): Drafted {
  const purpose = args.purpose ?? record.purpose;
  const files = {
    files: args.files ?? record.supportFiles,
    ...(purpose === undefined ? {} : { purpose }),
  };
  const text = revisedText(record, args);
  if (!text.ok) {
    return err("skill.invalid");
  }
  const base = record.base === undefined ? {} : { base: record.base };
  return draftOf({ name: record.name, ...files }, { kind: record.kind, text: text.value, ...base });
}
