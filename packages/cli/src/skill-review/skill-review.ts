import type { Id } from "@binference/core";
import type { EngineHandler, PublishPush } from "@binference/engine";
import { skillNoticePush } from "@binference/engine/notices";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { OperationName } from "@binference/protocol";
import type { AcceptedSkills } from "../skills/accepted-skills.js";
import type { ShelfSkill } from "../skills/skill-shelf.js";
import { ownerSkillHandlers } from "./owner-skill-handlers.js";
import { agentSkillHandlers, type SkillReviewParts } from "./skill-proposal-handlers.js";

/** The writes of the skill review, which run one at a time so no two read the same state. */
type Serial = <T>(run: () => Promise<T>) => Promise<T>;

function serial(): Serial {
  let queue: Promise<void> = Promise.resolve();
  return async (run) => {
    const next = queue.then(run);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

function inLine<N extends OperationName>(
  handler: EngineHandler<N>,
  line: Serial,
): EngineHandler<N> {
  return async (call) => line(async () => handler(call));
}

/**
 * The skill proposal operations and `skill/accept` (decision 0408), the agent's and the owner's,
 * over one store. Every write runs after the one before it ends, so a count of pending proposals,
 * a check that a proposal is pending and an apply never interleave.
 */
export function createSkillReviewHandlers(parts: SkillReviewParts): EngineHandlerTable {
  const agent = agentSkillHandlers(parts);
  const owner = ownerSkillHandlers(parts);
  const line = serial();
  return {
    "skillProposal/create": inLine(agent["skillProposal/create"], line),
    "skillProposal/revise": inLine(agent["skillProposal/revise"], line),
    "skillProposal/list": agent["skillProposal/list"],
    "skillProposal/get": agent["skillProposal/get"],
    "skillProposal/apply": inLine(owner["skillProposal/apply"], line),
    "skillProposal/reject": inLine(owner["skillProposal/reject"], line),
    "skill/accept": inLine(owner["skill/accept"], line),
  };
}

/**
 * What the skill shelf calls for each waiting workspace skill it finds (decision 0408): the owner
 * is told with `notice.skillHeld` once per skill and folder hash.
 */
export function tellWaiting(parts: {
  readonly accepted: Pick<AcceptedSkills, "tellOnce">;
  readonly agentName: (agent: Id<"agt">, signal: AbortSignal) => Promise<string | undefined>;
  readonly publish: PublishPush;
}): (skill: ShelfSkill) => Promise<void> {
  return async (skill) => {
    const { agent, name, hash } = skill;
    const signal = AbortSignal.timeout(10_000);
    if (agent === undefined || !(await parts.accepted.tellOnce({ agent, name, hash }, signal))) {
      return;
    }
    const agentName = (await parts.agentName(agent, signal)) ?? agent;
    parts.publish(skillNoticePush({ kind: "held", agent, agentName, name }));
  };
}
