import type { Id } from "@binference/core";
import type { LaunchTokenRequest } from "@binference/protocol";
import type { ReadPicture } from "../money-path/launch-upload.js";
import type { LaunchSetting } from "../venues/launch-settings.schema.js";

/** How long a launch draft waits for the owner's tap: 10 minutes (decision 0285). */
export const launchDraftOpenMs = 600_000;

/**
 * The agent's launch draft as the engine keeps it in memory (decision 0285): its id, which its
 * pushes carry, the random reference its buttons carry, the request the owner's tap proposes, the
 * launchpad settings with their defaults, and the owner's photo read once (decision 0286).
 */
export interface LaunchDraft {
  readonly id: string;
  readonly ref: string;
  readonly agentId: Id<"agt">;
  readonly agentName: string;
  /** The request as the tap proposes it; its `image` is the photo's `tg:` name, or `none`. */
  readonly request: LaunchTokenRequest;
  readonly settings: readonly LaunchSetting[];
  readonly picture?: ReadPicture;
  /** The drafting turn read outside content, which the draft's message warns of. */
  readonly hasOutsideContent: boolean;
  readonly expiresAtMs: number;
}

/** The engine's open launch drafts: at most one per agent, each until its first press or its end. */
export interface LaunchDraftShelf {
  /** Keeps a new draft, and answers the agent's open draft it replaces, if any. */
  put(draft: LaunchDraft): LaunchDraft | undefined;
  /** The open draft with this id, expired or not. */
  byId(id: string): LaunchDraft | undefined;
  /** Takes the open draft whose buttons carry this reference: no later press finds it. */
  take(ref: string): LaunchDraft | undefined;
  /** Takes every open draft whose time is up at `nowMs`. */
  takeDue(nowMs: number): readonly LaunchDraft[];
  /** When the next open draft's time is up, or `undefined` with none open. */
  nextDueMs(): number | undefined;
}

/** Creates an empty {@link LaunchDraftShelf}; a restart starts with none. */
export function createLaunchDraftShelf(): LaunchDraftShelf {
  const byAgent = new Map<Id<"agt">, LaunchDraft>();
  const open = (): readonly LaunchDraft[] => [...byAgent.values()];
  return {
    put(draft) {
      const replaced = byAgent.get(draft.agentId);
      byAgent.set(draft.agentId, draft);
      return replaced;
    },
    byId: (id) => open().find((draft) => draft.id === id),
    take(ref) {
      const draft = open().find((held) => held.ref === ref);
      if (draft !== undefined) {
        byAgent.delete(draft.agentId);
      }
      return draft;
    },
    takeDue(nowMs) {
      const due = open().filter((draft) => draft.expiresAtMs <= nowMs);
      due.forEach((draft) => byAgent.delete(draft.agentId));
      return due;
    },
    nextDueMs() {
      const times = open().map((draft) => draft.expiresAtMs);
      return times.length === 0 ? undefined : Math.min(...times);
    },
  };
}
