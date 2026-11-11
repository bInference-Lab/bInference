import { err, type Id, ok } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import { authorOf, journalConfigChange } from "@binference/engine/audit";
import { type SkillNotice, skillNoticePush } from "@binference/engine/notices";
import { applyProposal } from "./apply-proposal.js";
import { type ProposalRecord, proposalViewOf } from "./proposal-record.js";
import { scanProposal } from "./proposal-scan.js";
import { type Handlers, ownPending, type SkillReviewParts } from "./skill-proposal-handlers.js";

/** A skill change the owner made, as the journal and the notice tell it. */
interface OwnerChange {
  readonly agent: Id<"agt">;
  readonly name: string;
  readonly kind: "applied" | "accepted";
  readonly hashes: { readonly before?: string; readonly after: string };
}

// Journals the change under `skills.<agent>.<name>`, the folder hash before and after, with who
// made it and where, and tells it.
async function journaled(
  parts: SkillReviewParts,
  change: OwnerChange & { readonly caller: EngineCaller },
  signal: AbortSignal,
): Promise<void> {
  const author = authorOf(change.caller);
  const agentName = (await parts.agentName(change.agent, signal)) ?? change.agent;
  const notice: SkillNotice = {
    kind: change.kind,
    agent: change.agent,
    agentName,
    name: change.name,
    surface: author.surface,
  };
  const { before, after } = change.hashes;
  await journalConfigChange(
    parts.journal,
    {
      author,
      atMs: parts.clock.now(),
      path: `skills.${change.agent}.${change.name}`,
      ...(before === undefined ? {} : { before }),
      after,
      notices: [skillNoticePush(notice)],
    },
    { signal },
  );
}

function ended(
  parts: SkillReviewParts,
  record: ProposalRecord,
  status: "applied" | "rejected" | "stale",
): ProposalRecord {
  const at = parts.clock.now();
  return { ...record, status, decidedAt: at, updatedAt: at };
}

function applyHandler(parts: SkillReviewParts): Handlers["skillProposal/apply"] {
  return async ({ args, caller, signal }) => {
    const record = await ownPending(parts, args, signal);
    if (typeof record === "string") {
      return err(record);
    }
    // The exact text and files an apply writes are scanned again, not the findings stored with them.
    if (scanProposal(record.text, record.supportFiles).length > 0) {
      return err("skill.proposal_blocked");
    }
    const applied = await applyProposal({ ...parts.apply, ...parts }, record, signal);
    if (!applied.ok) {
      await parts.proposals.put(ended(parts, record, "stale"), signal);
      return err("skill.proposal_stale");
    }
    const done = ended(parts, record, "applied");
    await parts.proposals.put(done, signal);
    const change = { agent: record.agent, name: record.name, hashes: applied.value };
    await journaled(parts, { ...change, kind: "applied", caller }, signal);
    return ok({ proposal: proposalViewOf(done) });
  };
}

function rejectHandler(parts: SkillReviewParts): Handlers["skillProposal/reject"] {
  return async ({ args, caller, signal }) => {
    const record = await ownPending(parts, args, signal);
    if (typeof record === "string") {
      return err(record);
    }
    const reason = args.reason === undefined ? {} : { reason: args.reason };
    const done = { ...ended(parts, record, "rejected"), ...reason };
    await parts.proposals.put(done, signal);
    const agentName = (await parts.agentName(record.agent, signal)) ?? record.agent;
    const notice: SkillNotice = {
      kind: "rejected",
      agent: record.agent,
      agentName,
      name: record.name,
      surface: authorOf(caller).surface,
    };
    parts.journal.publish(skillNoticePush(notice));
    return ok({ proposal: proposalViewOf(done) });
  };
}

function acceptHandler(parts: SkillReviewParts): Handlers["skill/accept"] {
  return async ({ args, caller, signal }) => {
    const agent = args.agent;
    const waiting = (await parts.shelf.waiting(agent, signal)).find(
      ({ name }) => name === args.skill,
    );
    if (waiting === undefined) {
      const loaded = (await parts.shelf.list(agent, signal)).find(
        ({ name, place }) => name === args.skill && place === "workspace",
      );
      return loaded?.hash === args.hash ? ok({}) : err("skill.not_found");
    }
    if (waiting.hash !== args.hash) {
      return err("skill.changed");
    }
    const skill = { agent, name: args.skill, hash: args.hash };
    const before = await parts.accepted.accept(skill, signal);
    const hashes = before === undefined ? { after: args.hash } : { before, after: args.hash };
    await journaled(parts, { agent, name: args.skill, kind: "accepted", hashes, caller }, signal);
    return ok({});
  };
}

/**
 * The owner's side of the skill proposal operations (decision 0408), each with the `confirm`
 * scope the agent runtime and MCP clients never hold: `skillProposal/apply` refuses a proposal with
 * a finding (`skill.proposal_blocked`), one no longer pending (`skill.proposal_done`), and one
 * whose skill moved, which it marks `stale` (`skill.proposal_stale`); `skillProposal/reject`; and
 * `skill/accept`, which loads a waiting workspace skill at the hash the owner saw
 * (`skill.changed` for another). An apply and an accept are journaled and told; a reject is told.
 */
export function ownerSkillHandlers(
  parts: SkillReviewParts,
): Pick<Handlers, "skillProposal/apply" | "skillProposal/reject" | "skill/accept"> {
  return {
    "skillProposal/apply": applyHandler(parts),
    "skillProposal/reject": rejectHandler(parts),
    "skill/accept": acceptHandler(parts),
  };
}
