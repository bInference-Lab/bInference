import type { Id } from "@binference/core";
import type { EnginePush } from "./engine-push.js";
import { noticePush } from "./notice-push.js";

/** The agent a skill notice is about: its id and its name, as the notice's words show it. */
interface NoticeAgent {
  readonly agent: Id<"agt">;
  readonly agentName: string;
}

/**
 * What binference tells the owner of the agent's skills (decision 0408): a proposal made or
 * revised, with whether its scan blocks it; a proposal applied or rejected, and a waiting skill
 * accepted, each from the surface the owner used; and a workspace skill that waits for the owner.
 */
export type SkillNotice = NoticeAgent &
  (
    | {
        readonly kind: "proposed";
        readonly name: string;
        readonly proposal: string;
        readonly revised: boolean;
        readonly blocked: boolean;
      }
    | {
        readonly kind: "applied" | "rejected" | "accepted";
        readonly name: string;
        readonly surface: string;
      }
    | { readonly kind: "held"; readonly name: string }
  );

const keys = {
  proposed: "notice.skillProposed",
  applied: "notice.skillApplied",
  rejected: "notice.skillRejected",
  accepted: "notice.skillAccepted",
  held: "notice.skillHeld",
} as const;

function valuesOf(notice: SkillNotice): Readonly<Record<string, string>> {
  const named = { agent: notice.agentName, name: notice.name };
  if (notice.kind === "proposed") {
    const flags = {
      revised: notice.revised ? "yes" : "no",
      blocked: notice.blocked ? "yes" : "no",
    };
    return { ...named, proposal: notice.proposal, ...flags };
  }
  return notice.kind === "held" ? named : { ...named, surface: notice.surface };
}

/** The notice push of one {@link SkillNotice}, about its agent. */
export function skillNoticePush(notice: SkillNotice): EnginePush {
  return noticePush({ key: keys[notice.kind], agent: notice.agent, values: valuesOf(notice) });
}
