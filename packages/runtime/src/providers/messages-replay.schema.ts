import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";

/** A text block of a kept response. */
interface ReplayText {
  readonly type: "text";
  readonly text: string;
}

/** A thinking block with the signature that lets the model read it again. */
interface ReplayThinking {
  readonly type: "thinking";
  readonly thinking: string;
  readonly signature: string;
}

/** A thinking block the provider encrypted. */
interface ReplayRedacted {
  readonly type: "redacted_thinking";
  readonly data: string;
}

/** A tool call with its input as a JSON object. */
interface ReplayToolUse {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, JsonValue>>;
}

/** One content block a response's replay holds, as the Messages transport wrote it. */
export type ReplayBlock = ReplayText | ReplayThinking | ReplayRedacted | ReplayToolUse;

const jsonObjectSchema: z.ZodType<Readonly<Record<string, JsonValue>>> = z.record(
  z.string(),
  jsonValueSchema,
);

const replayContentSchema: z.ZodType<readonly ReplayBlock[]> = z
  .array(
    z.union([
      z.strictObject({ type: z.literal("text"), text: z.string().min(1) }),
      z.strictObject({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
      z.strictObject({ type: z.literal("redacted_thinking"), data: z.string() }),
      z.strictObject({
        type: z.literal("tool_use"),
        id: z.string(),
        name: z.string(),
        input: jsonObjectSchema,
      }),
    ]),
  )
  .min(1);

/** A replay's content blocks, or `undefined` when it holds anything the transport did not write. */
export function replayBlocksOf(content: JsonValue): readonly ReplayBlock[] | undefined {
  const parsed = replayContentSchema.safeParse(content);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A call's input as the JSON object the model wrote, or `{}` for anything else, such as the half
 * object of a call its output limit cut.
 */
export function inputObjectOf(text: string): Readonly<Record<string, JsonValue>> {
  try {
    const parsed = jsonObjectSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
