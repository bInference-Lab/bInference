import type { JsonValue } from "@binference/core";
import type { ImageContentType } from "@binference/protocol";
import type { ResponseReplay } from "./model-event.js";

/** A tool call as the model wrote it: its arguments are JSON text, parsed only by the tool box. */
export interface ToolCall {
  /** The model's own id for the call, which its result names. */
  readonly id: string;
  readonly name: string;
  readonly argumentsText: string;
}

/** A message of the owner, or a settle or wake-up message, that a turn takes or that joins it. */
export interface OwnerMessage {
  /** The chat queue's id for it (`msg_…`). */
  readonly id: string;
  readonly text: string;
  /** It is outside content: it has images, or a wake-up says so (runtime spec, section 5.4). */
  readonly outside: boolean;
}

/**
 * An image the owner sent, as a model that takes images reads it (decision 0227). It lives only
 * in the memory of the turn that took it: the transcript never holds its bytes.
 */
interface ModelImage {
  readonly contentType: ImageContentType;
  /** The image's bytes in base64. */
  readonly data: string;
}

/** The owner's side of the conversation. */
interface OwnerEntry {
  readonly role: "owner";
  readonly text: string;
  /** The images the owner sent with the text, which go before it; only for a model that reads them. */
  readonly images?: readonly ModelImage[];
}

/** One model response: its text, its reasoning and the tool calls it made. */
interface AgentEntry {
  readonly role: "agent";
  readonly text: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ToolCall[];
  /** What its provider wants back in place of the text, reasoning and calls, when it said so. */
  readonly replay?: ResponseReplay;
}

/** The result of one tool call, which every call in the conversation has exactly once. */
interface ToolEntry {
  readonly role: "tool";
  readonly callId: string;
  readonly name: string;
  readonly text: string;
  readonly isError: boolean;
}

/** One entry of the conversation a model call sends. */
export type ModelMessage = OwnerEntry | AgentEntry | ToolEntry;

/** A tool as the model sees it: its name, what it does, and the JSON Schema of its arguments. */
export interface ToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: { readonly [key: string]: JsonValue };
}
