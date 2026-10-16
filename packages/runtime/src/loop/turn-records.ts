import type { Result } from "@binference/core";
import type { TurnOutcome } from "@binference/store";
import type { ModelPrice } from "../usage/model-price.js";
import type { ModelFailure, ResponseReplay } from "./model-event.js";
import type { ModelImage, ModelMessage, ToolCall, ToolDeclaration } from "./model-message.js";
import type { ModelTransport } from "./ports.js";

// The values the turn loop's ports take and give (see ports.ts).

/** One model call: the conversation so far and the tools the model may call. */
export interface ModelRequest {
  /**
   * The stable prefix (runtime spec, section 7.1): the instructions, the workspace files and the
   * skills index, the same bytes from call to call while none of them changes.
   */
  readonly prefix: string;
  /** The history: the session's conversation before the call. */
  readonly messages: readonly ModelMessage[];
  /** The volatile tail: the live facts, sent after the history and never stored. */
  readonly tail?: string;
  readonly tools: readonly ToolDeclaration[];
}

/** One model of a turn's chain: its name, `<provider>/<model>`, and its transport. */
export interface ChainModel {
  readonly name: string;
  readonly transport: ModelTransport;
  /**
   * What the model charges, from `models.prices` or the built-in table, for a call whose provider
   * reports no cost of its own; absent when neither has a price, and such a call counts $0.
   */
  readonly price?: ModelPrice;
  /**
   * The model takes images as input: `models.imageInput` names it, or it is the vision model
   * (decision 0227). Absent, it never gets an image.
   */
  readonly readsImages?: true;
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
  /**
   * The tool finished something the owner hears of in a status line: the turn ends with it when it
   * ends well and has no other line.
   */
  readonly closingLine?: ClosingLine;
}

/** A status line a tool's work gives a turn that ends well: the first chat ended. */
export type ClosingLine = "firstChatDone";

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
  /** The tool asks the owner a question (`ask_owner`), which a proposal in its batch wins over. */
  readonly asksOwner: boolean;
  run(context: ToolRunContext): Promise<ToolOutcome>;
}

/** A call the tool box refused: it never runs, and the model reads why. */
interface RefusedCall {
  readonly ready: false;
  readonly text: string;
}

/** A call after the tool box checked it. */
export type PreparedCall = ReadyCall | RefusedCall;

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
export interface ProposalRecord {
  readonly call: ToolCall;
  readonly idempotencyKey: string;
}

/** A model response as the transcript keeps it; its calls are written one by one as they run. */
export interface ResponseRecord {
  readonly text: string;
  readonly reasoning: string;
  /** What its provider wants back in the calls that follow, kept as it came. */
  readonly replay?: ResponseReplay;
}

/**
 * A summary of the session's history as the transcript keeps it (runtime spec, section 7.3): the
 * events from `fromSeq` through `throughSeq` reach the model as this text from now on.
 */
export interface SummaryRecord {
  readonly text: string;
  readonly fromSeq: number;
  readonly throughSeq: number;
  /** An event it covers, or the summary before it, held outside content. */
  readonly outside: boolean;
}

/**
 * The vision model's description of one image of an owner's message (decision 0227), which the
 * transcript keeps as outside content in place of the image's bytes.
 */
export interface ImageDescriptionRecord {
  /** The chat queue's id of the message (`msg_…`). */
  readonly message: string;
  /** The image's place in the message, from 1. */
  readonly place: number;
  readonly text: string;
}

/** Why an image of the owner's message cannot be read (decision 0227). */
export type ImageReadRefusal = "not_found" | "too_large" | "format" | "unreadable";

/**
 * Reads one image of a message the turn took, whole, from the engine: the message's id
 * (`msg_…`) and the name the message gives the image. Rejects when the engine cannot answer, and
 * with the signal's reason once it aborts.
 */
export type ReadImage = (
  place: { readonly message: string; readonly image: string },
  signal: AbortSignal,
) => Promise<Result<ModelImage, ImageReadRefusal>>;

/** Which limit or step kept a turn from reading the owner's images (decision 0227). */
export type ImageProblem = "tooMany" | "tooLarge" | "format" | "unreadable" | "noVision";

/** How a turn ended, as the transcript keeps it. */
export interface TurnEndRecord {
  readonly outcome: TurnOutcome;
  readonly heldBack: number;
}

/**
 * Why a turn did not start: the engine refused it (runtime spec, section 4.2), or `unavailable`
 * when `turn/start` itself failed, so the engine holds no running turn and its messages wait.
 */
export type TurnRefusal = "budget" | "frozen" | "archived" | "not_found" | "unavailable";

/** What `turn/start` names: the messages the turn takes, and whether its context is marked. */
export interface TurnStartRequest {
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
  | { readonly line: "modelCallLimit" }
  /** The loop guard found the same call with the same result three times. */
  | { readonly line: "loop" }
  /** The agent's model budget of the day is spent: chat resumes at the owner's next midnight. */
  | { readonly line: "budget"; readonly resumesAt: number }
  /** The owner's images could not be read, and no model was called. */
  | { readonly line: "image"; readonly problem: ImageProblem }
  /** A tool of a turn that ended well finished something the owner hears of. */
  | { readonly line: ClosingLine };

/**
 * One attempt of a model call as `usage/record` takes it (runtime spec, section 8.3): the model
 * that answered or failed, its tokens and its cost. `key` names the record, so one sent twice is
 * counted once.
 */
export interface UsageRecord {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly usdMicros: bigint;
  readonly key: string;
}
