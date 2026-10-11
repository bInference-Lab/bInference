import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";

/** A JSON-RPC request id: a string or a number. */
export type RpcId = string | number;

/** A `tools/call` request as the MCP client wrote it on the server's stdin. */
export interface ToolCallLine {
  readonly id: RpcId;
  readonly method: "tools/call";
  readonly params: {
    readonly name: string;
    readonly arguments?: { readonly [key: string]: JsonValue };
  };
}

/** One content block of a tool's answer; only text blocks carry text. */
interface AnswerBlock {
  readonly type: string;
  readonly text?: string;
}

/** A JSON-RPC answer as the server wrote it on stdout: a result or an error. */
export interface AnswerLine {
  readonly id: RpcId;
  readonly result?: { readonly content?: readonly AnswerBlock[]; readonly isError?: boolean };
  readonly error?: { readonly message: string };
}

const rpcIdSchema = z.union([z.string(), z.number()]);

/** Parses a line of the server's stdin that calls a tool; any other message fails. */
export const toolCallLineSchema: z.ZodType<ToolCallLine> = z.looseObject({
  id: rpcIdSchema,
  method: z.literal("tools/call"),
  params: z.looseObject({
    name: z.string(),
    arguments: z.record(z.string(), jsonValueSchema).exactOptional(),
  }),
});

/** Parses a line of the server's stdout that answers a request; a notification fails. */
export const answerLineSchema: z.ZodType<AnswerLine> = z.looseObject({
  id: rpcIdSchema,
  result: z
    .looseObject({
      content: z
        .array(z.looseObject({ type: z.string(), text: z.string().exactOptional() }))
        .exactOptional(),
      isError: z.boolean().exactOptional(),
    })
    .exactOptional(),
  error: z.looseObject({ message: z.string() }).exactOptional(),
});
