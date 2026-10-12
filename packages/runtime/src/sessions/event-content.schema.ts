import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";

// What each kind of transcript event holds in its `content`, as the runtime writes and reads it.
// The transcript never changes, so a field added later is optional, and a stored event that no
// schema reads is left out of what the model sees.

/** An owner's message, or a settle message, that a turn took or that joined it. */
export interface OwnerTextContent {
  /** The chat queue's id for it (`msg_…`). */
  readonly message: string;
  readonly text: string;
}

/** One model response's text and reasoning; its calls follow as events of their own. */
export interface AgentTextContent {
  readonly text: string;
  readonly reasoning: string;
  /** What its provider wants back in the calls that follow (`ResponseReplay`). */
  readonly replay?: { readonly format: "messages"; readonly content: JsonValue };
}

/** A tool call as the model wrote it; a proposal also keeps the key it is sent with. */
export interface ToolCallContent {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
  readonly proposal?: true;
  readonly key?: string;
}

/** A tool call's result; `ran` is false for a call that never ran. */
export interface ToolResultContent {
  readonly callId: string;
  readonly name: string;
  readonly text: string;
  readonly isError: boolean;
  readonly ran: boolean;
}

/** Parses an owner's text. */
export const ownerTextContentSchema: z.ZodType<OwnerTextContent> = z.object({
  message: z.string(),
  text: z.string(),
});

/** Parses a response's text. */
export const agentTextContentSchema: z.ZodType<AgentTextContent> = z.object({
  text: z.string(),
  reasoning: z.string(),
  replay: z
    .strictObject({ format: z.literal("messages"), content: jsonValueSchema })
    .exactOptional(),
});

/** Parses a tool call. */
export const toolCallContentSchema: z.ZodType<ToolCallContent> = z.object({
  callId: z.string(),
  name: z.string(),
  arguments: z.string(),
  proposal: z.literal(true).exactOptional(),
  key: z.string().exactOptional(),
});

/** Parses a tool result. */
export const toolResultContentSchema: z.ZodType<ToolResultContent> = z.object({
  callId: z.string(),
  name: z.string(),
  text: z.string(),
  isError: z.boolean(),
  ran: z.boolean(),
});
