import type { JsonValue } from "@binference/core";

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

/** The owner's side of the conversation. */
interface OwnerEntry {
  readonly role: "owner";
  readonly text: string;
}

/** One model response: its text, its reasoning and the tool calls it made. */
interface AgentEntry {
  readonly role: "agent";
  readonly text: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ToolCall[];
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
