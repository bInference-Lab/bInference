import type { Result } from "@binference/core";
import type { TurnOutcome } from "@binference/store";
import type { ModelEvent, ModelFailure } from "./model-event.js";
import type { ModelMessage, OwnerMessage, ToolCall, ToolDeclaration } from "./model-message.js";

// What one turn of the loop works with. The composition binds each to a turn: the transport to
// the agent's model, the journal to `agent.sqlite`, the engine to the protocol client, the merge
// source to the session's chat queue.

/** One model call: the conversation so far and the tools the model may call. */
export interface ModelRequest {
  readonly instructions: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolDeclaration[];
}

/**
 * Streams one model response as events. It never throws: a failure is the stream's last event,
 * and an aborted signal ends the stream with an `aborted` error.
 */
export interface ModelTransport {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

/** What a tool does, which decides how the loop runs it (runtime spec, section 5.1). */
export type ToolKind = "read" | "propose" | "control";

/**
 * A tool's result, which the model reads. A tool's error is a result, never a turn failure. A
 * propose tool returns `isError` only when the engine refused the proposal for certain; on
 * anything uncertain (no answer, a broken connection) it throws, and the outcome is unknown.
 */
export interface ToolOutcome {
  readonly text: string;
  readonly isError: boolean;
  /** This result holds outside content, though its tool's results do not always. */
  readonly outside?: boolean;
  /** The tool asked the owner a question: the turn ends after this batch. */
  readonly endsTurn?: boolean;
}

/** What a tool's run receives. */
export interface ToolRunContext {
  /** Aborts at the call's time limit, or when the turn stops and the call can stop. */
  readonly signal: AbortSignal;
  /**
   * The call's key: its turn and its number in the turn. A propose call sends it as its write's
   * idempotency key; it is written with the committed mark before the engine hears of the call.
   */
  readonly idempotencyKey: string;
}

/** A call the tool box accepted: its tool exists and its arguments passed the tool's schema. */
export interface ReadyCall {
  readonly ready: true;
  readonly kind: ToolKind;
  /** A read that may run beside other such reads. */
  readonly parallel: boolean;
  /** Every result of this tool is outside content. */
  readonly outside: boolean;
  run(context: ToolRunContext): Promise<ToolOutcome>;
}

/** A call the tool box refused: it never runs, and the model reads why. */
interface RefusedCall {
  readonly ready: false;
  readonly text: string;
}

/** A call after the tool box checked it. */
export type PreparedCall = ReadyCall | RefusedCall;

/** The tools of a turn: what the model sees, and each call checked before it runs. */
export interface ToolBox {
  readonly declarations: readonly ToolDeclaration[];
  prepare(call: ToolCall): PreparedCall;
}

/** A tool call's result as the transcript keeps it. */
export interface ToolResultRecord {
  readonly callId: string;
  readonly name: string;
  readonly text: string;
  readonly isError: boolean;
  readonly outside: boolean;
  /** The tool's body started; false for a call that never ran. */
  readonly ran: boolean;
}

/** A propose call with the key it sends: written with the turn's committed mark. */
interface ProposalRecord {
  readonly call: ToolCall;
  readonly idempotencyKey: string;
}

/** A model response as the transcript keeps it; its calls are written one by one as they run. */
interface ResponseRecord {
  readonly text: string;
  readonly reasoning: string;
}

/** How a turn ended, as the transcript keeps it. */
interface TurnEndRecord {
  readonly outcome: TurnOutcome;
  readonly heldBack: number;
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

/**
 * Why a turn did not start: the engine refused it (runtime spec, section 4.2), or `unavailable`
 * when `turn/start` itself failed, so the engine holds no running turn and its messages wait.
 */
export type TurnRefusal = "budget" | "frozen" | "archived" | "not_found" | "unavailable";

/** What `turn/start` names: the messages the turn takes, and whether its context is marked. */
interface TurnStartRequest {
  readonly messages: readonly string[];
  readonly outsideContent: boolean;
}

/** Why a turn failed, as its status line names it. */
type TurnFailure = ModelFailure | "time_limit" | "proposal_unknown" | "engine";

/**
 * The one status line a turn ends with (runtime spec, section 4.4). A surface words it in the
 * owner's language.
 */
export type TurnStatusLine =
  | { readonly line: "proposalWaits" }
  | { readonly line: "moreProposals"; readonly count: number }
  | { readonly line: "proposalRefused" }
  | { readonly line: "stopped" }
  /** Stopped after the engine took the turn's proposal: its card is still open. */
  | { readonly line: "stoppedCardOpen" }
  | { readonly line: "failed"; readonly failure: TurnFailure }
  | { readonly line: "toolCallLimit" }
  | { readonly line: "modelCallLimit" };

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
