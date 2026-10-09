import type { Id } from "@binference/core";
import {
  type LimitName,
  type LimitsState,
  limitNames,
  limitsChanged,
} from "../policy/limit-change.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { wireNames } from "./limit-views.js";

/** The message key of the notice that announces a limit change (spec 4, section 4). */
export const limitChangeKey = "notice.limitChange";

/** The message key of the notice that announces a cancelled looser limit (spec 4, section 4). */
export const limitChangeCancelledKey = "notice.limitChangeCancelled";

/** Who asked for a limit move: the agent it moved, and the surface it came from. */
export interface LimitMover {
  readonly agent: Id<"agt">;
  readonly surface: string;
}

// The limits that wait in a state, each at a value other than the one in effect.
function waitingIn(state: LimitsState): readonly LimitName[] {
  return state.pending === undefined ? [] : limitsChanged(state.values, state.pending.values);
}

function isWaitingAlike(before: LimitsState, after: LimitsState, name: LimitName): boolean {
  const { pending } = before;
  return (
    pending !== undefined &&
    pending.atMs === after.pending?.atMs &&
    limitsChanged(pending.values, after.pending.values).every((changed) => changed !== name)
  );
}

// A limit that waits from now on: a new looser value, or one whose wait started again.
function waitingNotices(mover: LimitMover, before: LimitsState, after: LimitsState) {
  const { pending } = after;
  return pending === undefined
    ? []
    : waitingIn(after)
        .filter((name) => !waitingIn(before).includes(name) || !isWaitingAlike(before, after, name))
        .map((name) =>
          noticePush({
            key: limitChangeKey,
            agent: mover.agent,
            values: { surface: mover.surface, limit: wireNames[name], pending: "yes" },
            times: { when: pending.atMs },
          }),
        );
}

/**
 * The notices that announce a limit move on every surface, one per limit and none when it moved
 * nothing: a limit that changed now, a looser one with the time it applies, so the owner can
 * cancel a loosening they did not ask for, and a looser one that waited and is gone before its
 * time. `before` is the state in effect when the move was decided.
 */
export function limitNotices(
  mover: LimitMover,
  before: LimitsState,
  after: LimitsState,
): readonly EnginePush[] {
  const now = limitsChanged(before.values, after.values).map((name) =>
    noticePush({
      key: limitChangeKey,
      agent: mover.agent,
      values: { surface: mover.surface, limit: wireNames[name], pending: "no" },
    }),
  );
  const waitingAfter = waitingIn(after);
  const cancelled = limitNames
    .filter((name) => waitingIn(before).includes(name) && !waitingAfter.includes(name))
    .map((name) =>
      noticePush({
        key: limitChangeCancelledKey,
        agent: mover.agent,
        values: { limit: wireNames[name] },
      }),
    );
  return [...now, ...waitingNotices(mover, before, after), ...cancelled];
}
