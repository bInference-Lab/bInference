import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";

/** The longest message either side writes on the channel, in bytes of its line (decision 0300). */
export const maxMessageBytes = 1_048_576;

/** A request a plugin asks the host to fetch, as the channel carries it. */
export interface FetchRequestWire {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** Why the host did not fetch a request, or got no answer for it. */
export type FetchRefusal =
  /** The URL is not `https` on one of the plugin's declared hosts. */
  | "host_refused"
  /** A header or the body is not one the host sends. */
  | "bad_request"
  /** 8 of the plugin's fetches are open already. */
  | "busy"
  /** No answer came in 15 seconds. */
  | "timeout"
  /** The answer is larger than a message may be. */
  | "too_large"
  /** The request found no answer. */
  | "failed";

/** What the host sends a plugin. */
export type HostMessage =
  | {
      readonly kind: "start";
      /** The plugin's entry module: an absolute path inside its package folder. */
      readonly entry: string;
      /** The one folder the plugin may write. */
      readonly dataFolder: string;
      /** The plugin's settings, as its config schema read them. */
      readonly config: JsonValue;
      readonly hosts: readonly string[];
    }
  | {
      readonly kind: "call";
      readonly id: string;
      readonly tool: string;
      readonly input: JsonValue;
      /** How long the call has, from when the plugin reads it. */
      readonly timeoutMs: number;
    }
  | {
      readonly kind: "fetched";
      readonly id: string;
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
    }
  | { readonly kind: "fetchRefused"; readonly id: string; readonly refused: FetchRefusal };

/** What a plugin sends the host. */
export type PluginMessage =
  | { readonly kind: "ready"; readonly tools: readonly string[] }
  | { readonly kind: "result"; readonly id: string; readonly output: JsonValue }
  | { readonly kind: "failed"; readonly id: string; readonly code: string }
  | { readonly kind: "fetch"; readonly id: string; readonly request: FetchRequestWire }
  | { readonly kind: "log"; readonly level: "info" | "warn" | "error"; readonly code: string };

const messageId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const codeSchema = z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/);
const toolName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const headersSchema = z.record(z.string().max(256), z.string().max(8_192));

const fetchRequestSchema: z.ZodType<FetchRequestWire> = z.strictObject({
  url: z.string().max(2_048),
  method: z.enum(["GET", "POST"]),
  headers: headersSchema,
  body: z.string().exactOptional(),
});

/** The schema of {@link HostMessage}, which the plugin side parses. */
export const hostMessageSchema: z.ZodType<HostMessage> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("start"),
    entry: z.string().min(1).max(4_096),
    dataFolder: z.string().min(1).max(4_096),
    config: jsonValueSchema,
    hosts: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal("call"),
    id: messageId,
    tool: toolName,
    input: jsonValueSchema,
    timeoutMs: z.int().positive(),
  }),
  z.strictObject({
    kind: z.literal("fetched"),
    id: messageId,
    status: z.int().min(100).max(599),
    headers: headersSchema,
    body: z.string(),
  }),
  z.strictObject({
    kind: z.literal("fetchRefused"),
    id: messageId,
    refused: z.enum(["host_refused", "bad_request", "busy", "timeout", "too_large", "failed"]),
  }),
]);

/** The schema of {@link PluginMessage}, which the host parses: any other message stops the plugin. */
export const pluginMessageSchema: z.ZodType<PluginMessage> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ready"), tools: z.array(toolName).max(32) }),
  z.strictObject({ kind: z.literal("result"), id: messageId, output: jsonValueSchema }),
  z.strictObject({ kind: z.literal("failed"), id: messageId, code: codeSchema }),
  z.strictObject({ kind: z.literal("fetch"), id: messageId, request: fetchRequestSchema }),
  z.strictObject({
    kind: z.literal("log"),
    level: z.enum(["info", "warn", "error"]),
    code: codeSchema,
  }),
]);
