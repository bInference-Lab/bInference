import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { IntentProposerRef } from "../intents/intent-record.js";
import { proposerOf } from "../operations/engine-call.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { IntentStore } from "../ports.js";
import { openIntentOf } from "./open-intent.js";
import { proposeRescue, type RescueProposalParts } from "./propose-rescue.js";

/** The handler of `safety/rescue` (protocol spec, section 7.1). */
export interface RescueHandlers {
  readonly "safety/rescue": EngineHandler<"safety/rescue">;
}

/** What the rescue handler reads, plans and stores through. */
export interface RescueHandlersOptions extends RescueProposalParts {
  readonly intents: IntentStore;
}

/**
 * Creates the `safety/rescue` handler (decision 0044): it plans one rescue of every agent wallet
 * and answers its intent, which waits for the owner's tap. While a rescue has not ended, a second
 * call answers that one and plans nothing, so two calls never send twice; calls wait their turn
 * for that, each bounded by the protocol server's limit on calls in flight. Only the owner
 * proposes a rescue: a caller without `confirm`, or with `agent`, is `auth.scope`.
 */
export function createRescueHandlers(options: RescueHandlersOptions): RescueHandlers {
  let queue: Promise<void> = Promise.resolve();
  const rescue = async (
    proposerRef: IntentProposerRef,
    signal: AbortSignal,
  ): Promise<Result<{ readonly intent: Id<"int"> }, ProtocolErrorCode>> => {
    const running = await openIntentOf(options.intents, { kind: "rescue" }, { signal });
    if (running !== undefined) {
      return ok({ intent: running.id });
    }
    const proposed = await proposeRescue(options, { proposerRef, signal });
    return proposed.ok ? ok({ intent: proposed.value.record.id }) : proposed;
  };
  return {
    async "safety/rescue"({ caller, signal }) {
      const proposer = proposerOf(caller);
      if (proposer?.role !== "owner") {
        return err("auth.scope");
      }
      const turn = queue.then(async () => rescue(proposer.ref, signal));
      queue = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
  };
}
