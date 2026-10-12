import type { Result } from "@binference/core";
import type { TurnOutcome } from "@binference/store";
import type { ModelEvent } from "./model-event.js";
import type { OwnerMessage, ToolCall, ToolDeclaration } from "./model-message.js";
import type {
  ChainModel,
  ModelRequest,
  PreparedCall,
  ProposalRecord,
  ResponseRecord,
  ToolResultRecord,
  TurnEndRecord,
  TurnRefusal,
  TurnStartRequest,
  TurnStatusLine,
} from "./turn-records.js";

// What one turn of the loop works with. The composition binds each to a turn: the transport to
// the agent's model, the journal to `agent.sqlite`, the engine to the protocol client, the merge
// source to the session's chat queue. Each port has a contract suite in src/contracts/.

/**
 * Streams one model response as events. It never throws: a failure is the stream's last event,
 * and an aborted signal ends the stream with an `aborted` error.
 */
export interface ModelTransport {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

/**
 * The models a turn's role may call, in the order a call tries them, and the rest of a provider
 * that keeps failing (runtime spec, section 8.2): the role's model then its fallbacks, or only the
 * model the owner picked. A rest outlives the turn that began it.
 */
export interface ModelChain {
  /** Never empty. */
  readonly models: readonly ChainModel[];
  /** Whether the provider of the model named `<provider>/<model>` rests now. */
  resting(model: string): boolean;
  /**
   * The model's provider rests from now for the cooldown (`models.cooldownMs`), or for `atLeastMs`
   * when that is longer, as when the provider asked for a longer wait.
   */
  rest(model: string, atLeastMs: number): void;
}

/** The tools of a turn: what the model sees, and each call checked before it runs. */
export interface ToolBox {
  readonly declarations: readonly ToolDeclaration[];
  prepare(call: ToolCall): PreparedCall;
}

/**
 * Writes one turn's transcript in the order the runtime spec gives (section 11). Each write is
 * done before the loop goes on, and a write that fails throws.
 */
export interface TurnJournal {
  response(response: ResponseRecord, signal: AbortSignal): Promise<void>;
  /** A read or control call, before it runs or gets its "not run" result. */
  toolCall(call: ToolCall, signal: AbortSignal): Promise<void>;
  /** A propose call and the turn's committed mark, in one write, before the engine hears of it. */
  proposal(proposal: ProposalRecord, signal: AbortSignal): Promise<void>;
  toolResult(result: ToolResultRecord, signal: AbortSignal): Promise<void>;
  /** Messages that joined the turn at a merge point. */
  joined(messages: readonly OwnerMessage[], signal: AbortSignal): Promise<void>;
  /** The turn holds outside content from now on. */
  markOutside(signal: AbortSignal): Promise<void>;
  end(end: TurnEndRecord, signal: AbortSignal): Promise<void>;
}

/** The engine's side of one turn: its start, its mark, its text, its status and its end. */
export interface TurnEngine {
  start(
    request: TurnStartRequest,
    signal: AbortSignal,
  ): Promise<Result<{ readonly budgetLeftMicros: bigint }, TurnRefusal>>;
  /** `turn/mark`: the turn holds outside content. Throws when the engine did not take the mark. */
  mark(signal: AbortSignal): Promise<void>;
  say(text: string, signal: AbortSignal): Promise<void>;
  status(line: TurnStatusLine, signal: AbortSignal): Promise<void>;
  end(outcome: TurnOutcome, signal: AbortSignal): Promise<void>;
}

/** The chat queue's side of a running turn: the messages that join it at a merge point. */
export interface MergeSource {
  /**
   * Takes the messages that wait to join, oldest first and at most 20; none in `after` mode. The
   * loop asks only where a model call can follow to answer them.
   */
  take(signal: AbortSignal): Promise<readonly OwnerMessage[]>;
}
