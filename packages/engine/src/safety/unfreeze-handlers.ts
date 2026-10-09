import { err, type Id, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { IntentProposerRef, IntentRecord } from "../intents/intent-record.js";
import { unfreezeRequestDocument } from "../intents/unfreeze-quote.js";
import { type EngineHandler, proposerOf } from "../operations/engine-call.js";
import type { IntentStore } from "../ports.js";
import { openIntentOf } from "./open-intent.js";
import { proposeUnfreeze, type UnfreezeProposalParts } from "./propose-unfreeze.js";
import { type UnfreezeWriteParts, writeUnfreeze } from "./write-unfreeze.js";

/** The handler of `safety/unfreeze` (protocol spec, section 7.1). */
export interface UnfreezeHandlers {
  readonly "safety/unfreeze": EngineHandler<"safety/unfreeze">;
}

/** What the unfreeze handler reads, plans, stores and writes through. */
export interface UnfreezeHandlersOptions extends UnfreezeProposalParts, UnfreezeWriteParts {
  readonly intents: IntentStore;
}

type Answer = Result<{ readonly intent?: Id<"int"> }, ProtocolErrorCode>;

// An unfreeze of the same agent, or of the whole install when none is named.
function isSameScope(record: IntentRecord, agent: Id<"agt"> | undefined): boolean {
  return unfreezeRequestDocument.decode(record.request).agent === agent;
}

// One that has not ended answers the call; one a stop left `confirmed` is written first.
async function goOn(
  options: UnfreezeHandlersOptions,
  open: IntentRecord,
  signal: AbortSignal,
): Promise<Answer> {
  const snapshot =
    open.state === "confirmed" ? await options.stored.snapshot(open.id, { signal }) : undefined;
  if (snapshot !== undefined) {
    await writeUnfreeze(options, snapshot, signal);
  }
  return ok({ intent: open.id });
}

async function unfreeze(
  options: UnfreezeHandlersOptions,
  call: {
    readonly agent: Id<"agt"> | undefined;
    readonly proposerRef: IntentProposerRef;
    readonly signal: AbortSignal;
  },
): Promise<Answer> {
  const { agent, signal } = call;
  const matches = (record: IntentRecord): boolean => isSameScope(record, agent);
  const open = await openIntentOf(options.intents, { kind: "unfreeze", matches }, { signal });
  if (open !== undefined) {
    return goOn(options, open, signal);
  }
  const proposed = await proposeUnfreeze(options, {
    ...(agent === undefined ? {} : { agent }),
    proposerRef: call.proposerRef,
    signal,
  });
  if (!proposed.ok) {
    return proposed;
  }
  return ok(proposed.value === undefined ? {} : { intent: proposed.value.record.id });
}

/**
 * Creates the `safety/unfreeze` handler (decision 0128): it unfreezes nothing on the call. It
 * opens an unfreeze card for the agent the call names, or for every frozen agent and the install,
 * and answers its intent, which waits for the owner's tap from any surface; with nothing frozen it
 * answers no intent. While an unfreeze of the same scope has not ended, a call answers that one,
 * and writes one a stop left `confirmed`; calls wait their turn, so two calls never open two
 * cards. Only the owner asks: a caller without `confirm`, or with `agent`, is `auth.scope`.
 */
export function createUnfreezeHandlers(options: UnfreezeHandlersOptions): UnfreezeHandlers {
  let queue: Promise<void> = Promise.resolve();
  return {
    async "safety/unfreeze"({ args, caller, signal }) {
      const proposer = proposerOf(caller);
      if (proposer?.role !== "owner") {
        return err("auth.scope");
      }
      const call = { agent: args.agent, proposerRef: proposer.ref, signal };
      const turn = queue.then(async () => unfreeze(options, call));
      queue = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
  };
}
