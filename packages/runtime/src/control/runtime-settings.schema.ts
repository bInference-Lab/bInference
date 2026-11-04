import { decimalStringSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { type Locale, localeSchema } from "@binference/protocol";
import { z } from "zod";

/** One model provider as the runtime calls it, its key already read from its secret source. */
export interface RuntimeProvider {
  readonly kind: "binference" | "openai" | "anthropic";
  readonly baseUrl?: string;
  /** The provider's key; a provider without one is called without a key. */
  readonly apiKey?: string;
}

/** One model's prices per million tokens, in micro-dollars. */
export interface RuntimeModelPrice {
  readonly inputPerMTokUsd: bigint;
  readonly outputPerMTokUsd: bigint;
  readonly cachedPerMTokUsd: bigint;
}

/** The models the owner picked for one agent, by role, each `<provider>/<model>` (decision 0204). */
export interface AgentModelPicks {
  readonly main?: string;
  readonly fast?: string;
  readonly vision?: string;
}

/** The models section of the settings (config spec, section 6.3), keys resolved. */
export interface RuntimeModels {
  readonly providers: Readonly<Record<string, RuntimeProvider>>;
  readonly main?: string;
  readonly fast?: string;
  readonly vision?: string;
  /** The models that take images as input (decision 0227); the vision model reads them by its role. */
  readonly imageInput: readonly string[];
  readonly fallbacks: { readonly main: readonly string[]; readonly fast: readonly string[] };
  readonly idleTimeoutMs: number;
  readonly cooldownMs: number;
  readonly maxToolCallsPerTurn: number;
  readonly loopDetection: boolean;
  /** Keyed by `<provider>/<model>`. */
  readonly prices: Readonly<Record<string, RuntimeModelPrice>>;
  /** Each agent's picked models, by agent id; a role it picked none for uses the config's. */
  readonly picked?: Readonly<Record<string, AgentModelPicks>>;
}

/** The web search provider and the keys the search tools use, resolved. */
export interface RuntimeSearch {
  /** The provider the owner picked; without one, the first of Brave and Tavily with a key. */
  readonly provider?: "brave" | "tavily";
  readonly keys: { readonly brave?: string; readonly tavily?: string };
  readonly xApiKey?: string;
}

/** The owner's proxy as the runtime reaches the network through it, read from its secret source. */
export type RuntimeProxy = { readonly url: string } | "unread";

/** The outbound network: `network.proxy` and `network.noProxy` (config spec, section 6). */
export interface RuntimeNetwork {
  /**
   * The proxy URL, credentials included; `unread` when config names one the engine could not
   * read, which holds every request it would carry; absent without a proxy.
   */
  readonly proxy?: RuntimeProxy;
  readonly noProxy: readonly string[];
}

/** One tool of a community plugin, as its manifest declares it. */
export interface RuntimePluginTool {
  /** Its name in the manifest; the agent sees it as `<id>__<name>`. */
  readonly name: string;
  readonly description: string;
  /** The JSON Schema of its input, an object that names every field. */
  readonly input: Readonly<Record<string, JsonValue>>;
}

/** An enabled community plugin whose tools the agent may call (decision 0349). */
export interface RuntimePlugin {
  /** Its `plg_` id, which `plugin/call` names. */
  readonly plugin: string;
  /** Its id in its manifest, such as `fear-index`. */
  readonly id: string;
  readonly tools: readonly RuntimePluginTool[];
}

/**
 * What the runtime needs of the config and nothing more (runtime spec, section 2.2): the models
 * with each provider's key, how a message during a turn is handled, the search providers and
 * their keys, the owner's language and time zone, and the owner's proxy. It holds secrets: it
 * crosses only the runtime's standard input and is never logged.
 */
export interface RuntimeSettings {
  readonly models: RuntimeModels;
  readonly chats: { readonly newMessageMode: "merge" | "after" };
  readonly search: RuntimeSearch;
  readonly owner: { readonly locale: Locale; readonly timezone: string };
  readonly network: RuntimeNetwork;
  /** The enabled community plugins and their tools; none when absent (decision 0349). */
  readonly plugins?: readonly RuntimePlugin[];
}

/** A {@link RuntimeModelPrice} as JSON carries it, prices as decimal strings. */
interface RuntimeModelPriceWire {
  readonly inputPerMTokUsd: string;
  readonly outputPerMTokUsd: string;
  readonly cachedPerMTokUsd: string;
}

/** A {@link RuntimePlugin} as JSON carries it, each tool's input schema not yet read. */
interface RuntimePluginWire extends Omit<RuntimePlugin, "tools"> {
  readonly tools: readonly (Omit<RuntimePluginTool, "input"> & {
    readonly input: Readonly<Record<string, unknown>>;
  })[];
}

/** {@link RuntimeSettings} as JSON carries them. */
export interface RuntimeSettingsWire extends Omit<RuntimeSettings, "models" | "owner" | "plugins"> {
  readonly models: Omit<RuntimeModels, "prices"> & {
    readonly prices: Readonly<Record<string, RuntimeModelPriceWire>>;
  };
  readonly owner: { readonly locale: string; readonly timezone: string };
  readonly plugins?: readonly RuntimePluginWire[];
}

const nameSchema = z.string().min(1).max(200);
const secretTextSchema = z.string().min(1).max(4_096);

const providerSchema = z.strictObject({
  kind: z.enum(["binference", "openai", "anthropic"]),
  baseUrl: z.url().max(2_048).exactOptional(),
  apiKey: secretTextSchema.exactOptional(),
});

const priceSchema = z.strictObject({
  inputPerMTokUsd: decimalStringSchema,
  outputPerMTokUsd: decimalStringSchema,
  cachedPerMTokUsd: decimalStringSchema,
});

const modelsSchema = z.strictObject({
  providers: z.record(nameSchema, providerSchema),
  main: nameSchema.exactOptional(),
  fast: nameSchema.exactOptional(),
  vision: nameSchema.exactOptional(),
  imageInput: z.array(nameSchema).max(64),
  fallbacks: z.strictObject({
    main: z.array(nameSchema).max(16),
    fast: z.array(nameSchema).max(16),
  }),
  idleTimeoutMs: z.int().positive(),
  cooldownMs: z.int().positive(),
  maxToolCallsPerTurn: z.int().positive(),
  loopDetection: z.boolean(),
  prices: z.record(nameSchema, priceSchema),
  picked: z
    .record(
      nameSchema,
      z.strictObject({
        main: nameSchema.exactOptional(),
        fast: nameSchema.exactOptional(),
        vision: nameSchema.exactOptional(),
      }),
    )
    .exactOptional(),
});

const pluginSchema: z.ZodType<RuntimePlugin, RuntimePluginWire> = z.strictObject({
  plugin: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
  tools: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(64),
        description: z.string().min(1).max(1_000),
        input: z.record(z.string(), jsonValueSchema),
      }),
    )
    .max(32),
});

/** Decodes {@link RuntimeSettings} from JSON, and encodes them back. */
export const runtimeSettingsSchema: z.ZodType<RuntimeSettings, RuntimeSettingsWire> =
  z.strictObject({
    models: modelsSchema,
    chats: z.strictObject({ newMessageMode: z.enum(["merge", "after"]) }),
    search: z.strictObject({
      provider: z.enum(["brave", "tavily"]).exactOptional(),
      keys: z.strictObject({
        brave: secretTextSchema.exactOptional(),
        tavily: secretTextSchema.exactOptional(),
      }),
      xApiKey: secretTextSchema.exactOptional(),
    }),
    owner: z.strictObject({ locale: localeSchema, timezone: z.string().min(1).max(64) }),
    network: z.strictObject({
      proxy: z
        .union([z.strictObject({ url: secretTextSchema }), z.literal("unread")])
        .exactOptional(),
      noProxy: z.array(z.string().min(1).max(300)).max(256),
    }),
    plugins: z.array(pluginSchema).max(64).exactOptional(),
  });
