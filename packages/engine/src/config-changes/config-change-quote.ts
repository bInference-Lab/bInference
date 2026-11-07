import type { IntentView } from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { epochMsSchema } from "../records/record-fields.js";

/** The request of a `configChange` intent: a merge patch over `config.json5`, and its reason. */
export type ConfigChangeRequest = Extract<IntentView["request"], { readonly kind: "configChange" }>;

/** A JSON merge patch over `config.json5`, as `config/propose` takes it. */
export type ConfigPatch = ConfigChangeRequest["patch"];

/**
 * One key a config change sets or removes: its dotted path, and the value the engine runs with
 * before and after it, defaults included, as JSON text, `null` for a key with no value, each
 * secret source shown as its kind (decision 0393).
 */
export interface ConfigKeyChange {
  readonly path: string;
  readonly before: string;
  readonly after: string;
}

/**
 * What a config change's card confirms (decision 0393): each key it changes, before and after,
 * whether a restart applies it, and when it was read. The intent keeps it in its `quote` column,
 * so the card's terms hash binds every key and value it names.
 */
export interface ConfigChangeQuote {
  readonly changes: readonly ConfigKeyChange[];
  readonly restartNeeded: boolean;
  readonly quotedAtMs: number;
}

/** The most keys one change may change, and the longest value text its card shows. */
export const configChangeLimits: { readonly keys: number; readonly valueChars: number } = {
  keys: 20,
  valueChars: 2_000,
};

const valueText = z.string().max(configChangeLimits.valueChars);

const configChangeQuoteSchema: z.ZodType<ConfigChangeQuote> = z.strictObject({
  changes: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(200),
        before: valueText,
        after: valueText,
      }),
    )
    .min(1)
    .max(configChangeLimits.keys),
  restartNeeded: z.boolean(),
  quotedAtMs: epochMsSchema,
});

/** A config change's quote, in the `quote` column of a `configChange` intent. */
export const configChangeQuoteDocument: DocumentCodec<ConfigChangeQuote> = documentCodec(
  "config change quote",
  configChangeQuoteSchema,
);

const configChangeRequestSchema: z.ZodType<ConfigChangeRequest> = z.strictObject({
  kind: z.literal("configChange"),
  patch: z.record(z.string(), z.unknown()),
  reason: z.string().min(1).max(500).exactOptional(),
});

/** The request a config change stores: its merge patch and the reason the proposer gave. */
export const configChangeRequestDocument: DocumentCodec<ConfigChangeRequest> = documentCodec(
  "config change request",
  configChangeRequestSchema,
);
