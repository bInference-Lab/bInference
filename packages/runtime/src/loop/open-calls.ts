import type { ToolCall } from "./model-message.js";
import type { TurnJournal } from "./ports.js";

/** A call the journal holds with no result yet, and whether it is the turn's proposal. */
export interface OpenCall {
  readonly call: ToolCall;
  readonly proposal: boolean;
}

/** A journal that knows which calls it wrote without a result. */
export interface TrackedJournal extends TurnJournal {
  open(): readonly OpenCall[];
}

/**
 * Wraps a turn's journal to keep the calls written without a result, so a turn that fails can
 * still give each its result (runtime spec, invariant 3).
 */
export function trackOpenCalls(journal: TurnJournal): TrackedJournal {
  const open = new Map<string, OpenCall>();
  return {
    ...journal,
    toolCall: async (call, signal) => {
      await journal.toolCall(call, signal);
      open.set(call.id, { call, proposal: false });
    },
    proposal: async (proposal, signal) => {
      await journal.proposal(proposal, signal);
      open.set(proposal.call.id, { call: proposal.call, proposal: true });
    },
    toolResult: async (result, signal) => {
      await journal.toolResult(result, signal);
      open.delete(result.callId);
    },
    open: () => [...open.values()],
  };
}
