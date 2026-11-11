import { type Clock, err, type Id, type IdSource, ok } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import type { ConfigChangeParts } from "@binference/engine/audit";
import { skillNoticePush } from "@binference/engine/notices";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { type ProtocolErrorCode, skillProposalLimits } from "@binference/protocol";
import type { AcceptedSkills } from "../skills/accepted-skills.js";
import { readSkillTextFile } from "../skills/skill-folder.js";
import type { ShelfSkill, SkillShelf } from "../skills/skill-shelf.js";
import type { ApplyParts } from "./apply-proposal.js";
import { draftProposal, type ProposalDraft, revisedDraft } from "./proposal-drafts.js";
import { type ProposalRecord, proposalViewOf } from "./proposal-record.js";
import { scanProposal } from "./proposal-scan.js";
import type { ProposalStore } from "./proposal-store.js";
import { proposalDetailOf } from "./proposal-views.js";

/** What the skill proposal operations read, write and tell (decision 0408). */
export interface SkillReviewParts {
  readonly shelf: SkillShelf;
  readonly accepted: AcceptedSkills;
  readonly proposals: ProposalStore;
  readonly apply: Omit<ApplyParts, "shelf" | "accepted">;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** The agent's name, as notices show it, or `undefined` for an agent the install lacks. */
  readonly agentName: (agent: Id<"agt">, signal: AbortSignal) => Promise<string | undefined>;
  /** Where an apply and an accept are journaled; its `publish` tells every notice. */
  readonly journal: ConfigChangeParts;
}

/** The skill proposal operations' handlers, by name. */
export type Handlers = Pick<
  Required<EngineHandlerTable>,
  | "skillProposal/create"
  | "skillProposal/revise"
  | "skillProposal/list"
  | "skillProposal/get"
  | "skillProposal/apply"
  | "skillProposal/reject"
  | "skill/accept"
>;

// A proposal is written by the runtime the engine runs now, in a turn of its agent that read no
// outside content; any other caller has no mark, or a marked one.
function isCleanTurn(caller: EngineCaller): boolean {
  return caller.turn?.hasOutsideContent === false;
}

async function pendingOf(parts: SkillReviewParts, agent: Id<"agt">, signal: AbortSignal) {
  const all = await parts.proposals.list(signal);
  return all.filter((record) => record.agent === agent && record.status === "pending");
}

async function readSkillMd(skill: ShelfSkill, signal: AbortSignal): Promise<string | undefined> {
  const read = await readSkillTextFile(skill, "SKILL.md", signal);
  return read.ok ? read.value : undefined;
}

function recordOf(
  parts: SkillReviewParts,
  draft: ProposalDraft,
  kept: Pick<ProposalRecord, "proposal" | "agent" | "createdAt">,
): ProposalRecord {
  const findings = scanProposal(draft.text, draft.supportFiles);
  // Only these three carry over from a revised record: its text, files and words are the draft's.
  const { proposal, agent, createdAt } = kept;
  const at = { proposal, agent, createdAt, updatedAt: parts.clock.now() };
  return { ...draft, ...at, status: "pending", findings };
}

/** How a proposal came to be told: made now, or revised. */
type ProposalTold = "made" | "revised";

async function tellProposed(
  parts: SkillReviewParts,
  record: ProposalRecord,
  told: ProposalTold,
): Promise<void> {
  const revised = told === "revised";
  const signal = AbortSignal.timeout(10_000);
  const agentName = (await parts.agentName(record.agent, signal)) ?? record.agent;
  const blocked = record.findings.length > 0;
  const { agent, name, proposal } = record;
  const notice = { kind: "proposed", agent, agentName, name, proposal, revised, blocked } as const;
  parts.journal.publish(skillNoticePush(notice));
}

function createHandler(parts: SkillReviewParts): Handlers["skillProposal/create"] {
  return async ({ args, caller, signal }) => {
    if (!isCleanTurn(caller)) {
      return err("skill.outside_content");
    }
    const pending = await pendingOf(parts, args.agent, signal);
    if (pending.length >= skillProposalLimits.pendingPerAgent) {
      return err("skill.proposal_limit");
    }
    const skills = await parts.shelf.list(args.agent, signal);
    const waiting = new Set(
      (await parts.shelf.waiting(args.agent, signal)).map(({ name }) => name),
    );
    const readText = async (skill: ShelfSkill) => readSkillMd(skill, signal);
    const draft = await draftProposal(args, { skills, waiting, pending, readText });
    if (!draft.ok) {
      return draft;
    }
    const at = { proposal: parts.ids.next("skp"), agent: args.agent, createdAt: parts.clock.now() };
    const record = recordOf(parts, draft.value, at);
    await parts.proposals.put(record, signal);
    await tellProposed(parts, record, "made");
    return ok({ proposal: proposalViewOf(record) });
  };
}

// The agent's own pending proposal, or the code that refuses the call.
export async function ownPending(
  parts: SkillReviewParts,
  args: { readonly proposal: Id<"skp">; readonly agent?: Id<"agt"> },
  signal: AbortSignal,
): Promise<ProposalRecord | ProtocolErrorCode> {
  const record = await parts.proposals.get(args.proposal, signal);
  if (record === undefined || (args.agent !== undefined && record.agent !== args.agent)) {
    return "skill.proposal_not_found";
  }
  return record.status === "pending" ? record : "skill.proposal_done";
}

function reviseHandler(parts: SkillReviewParts): Handlers["skillProposal/revise"] {
  return async ({ args, caller, signal }) => {
    if (!isCleanTurn(caller)) {
      return err("skill.outside_content");
    }
    const record = await ownPending(parts, args, signal);
    if (typeof record === "string") {
      return err(record);
    }
    const draft = revisedDraft(record, args);
    if (!draft.ok) {
      return draft;
    }
    const revised = recordOf(parts, draft.value, record);
    await parts.proposals.put(revised, signal);
    await tellProposed(parts, revised, "revised");
    return ok({ proposal: proposalViewOf(revised) });
  };
}

function listHandler(parts: SkillReviewParts): Handlers["skillProposal/list"] {
  return async ({ args, signal }) => {
    const all = await parts.proposals.list(signal);
    const kept = all.filter(
      (record) =>
        (args.agent === undefined || record.agent === args.agent) &&
        (args.status === undefined || record.status === args.status),
    );
    const limit = args.limit ?? skillProposalLimits.listDefault;
    return ok({ items: kept.slice(0, limit).map(proposalViewOf) });
  };
}

function getHandler(parts: SkillReviewParts): Handlers["skillProposal/get"] {
  return async ({ args, signal }) => {
    const record = await parts.proposals.get(args.proposal, signal);
    return record === undefined ? err("skill.proposal_not_found") : ok(proposalDetailOf(record));
  };
}

/**
 * The agent's side of the skill proposal operations (decision 0408): `skillProposal/create` and
 * `skillProposal/revise`, only from the runtime's clean turn (`skill.outside_content`), each
 * scanned, stored and told to the owner; and the reads `skillProposal/list` and
 * `skillProposal/get`. The owner's side is in `owner-skill-handlers.ts`.
 */
export function agentSkillHandlers(
  parts: SkillReviewParts,
): Pick<
  Handlers,
  "skillProposal/create" | "skillProposal/revise" | "skillProposal/list" | "skillProposal/get"
> {
  return {
    "skillProposal/create": createHandler(parts),
    "skillProposal/revise": reviseHandler(parts),
    "skillProposal/list": listHandler(parts),
    "skillProposal/get": getHandler(parts),
  };
}
