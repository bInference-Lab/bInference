import { z } from "zod";
import { type SecretSource, secretSourceSchema } from "./secret-source.schema.js";
import { modelSchema, usdSchema } from "./value-formats.schema.js";

/** The owner's Telegram bot. */
export interface TelegramConfig {
  readonly botToken: SecretSource;
  readonly mode: "polling" | "webhook";
  /** Required with the `webhook` mode. */
  readonly webhookSecret?: SecretSource;
  readonly confirmBotToken?: SecretSource;
  readonly groups: boolean;
  readonly topicsPerAgent: boolean;
}

/** The wire format a model provider speaks. */
export type ProviderKind = "binference" | "openai" | "anthropic";

/** One model provider, named by its key in `models.providers`. */
export interface ProviderConfig {
  readonly kind: ProviderKind;
  readonly baseUrl?: string;
  readonly apiKey?: SecretSource;
}

/** The fallback models of each role, tried in order on a provider failure. */
export interface FallbackConfig {
  readonly main: readonly string[];
  readonly fast: readonly string[];
}

/** One model's prices per million tokens, in `bigint` micro-dollars. */
export interface ModelPriceConfig {
  readonly inputPerMTokUsd: bigint;
  readonly outputPerMTokUsd: bigint;
  readonly cachedPerMTokUsd: bigint;
}

/** The model providers, the model of each role, and the turn limits. */
export interface ModelsConfig {
  readonly providers: Readonly<Record<string, ProviderConfig>>;
  readonly main?: string;
  readonly fast?: string;
  readonly vision?: string;
  readonly fallbacks: FallbackConfig;
  readonly idleTimeoutMs: number;
  readonly cooldownMs: number;
  readonly maxToolCallsPerTurn: number;
  readonly loopDetection: boolean;
  /** Keyed by `<provider>/<model>`. */
  readonly prices: Readonly<Record<string, ModelPriceConfig>>;
}

/** Parses `telegram`. */
export const telegramSchema: z.ZodType<TelegramConfig> = z
  .strictObject({
    botToken: secretSourceSchema.describe("The owner's BotFather token."),
    mode: z.enum(["polling", "webhook"]).prefault("polling").describe("How updates arrive."),
    webhookSecret: secretSourceSchema
      .exactOptional()
      .describe("Checks webhook calls; required with the webhook mode."),
    confirmBotToken: secretSourceSchema
      .exactOptional()
      .describe("A second bot that only sends confirmations."),
    groups: z.boolean().prefault(false).describe("Whether the bot answers in group chats."),
    topicsPerAgent: z.boolean().prefault(true).describe("One direct-message topic per agent."),
  })
  .describe("The owner's Telegram bot.");

const providerSchema = z.strictObject({
  kind: z.enum(["binference", "openai", "anthropic"]).describe("The provider's wire format."),
  baseUrl: z
    .url()
    .exactOptional()
    .describe("Where to call; the binference AI gateway for the binference kind."),
  apiKey: secretSourceSchema.exactOptional().describe("The provider's key."),
});

const modelRole = (role: string) => modelSchema.exactOptional().describe(`The model that ${role}.`);

const fallbackList = (role: string) =>
  z.array(modelSchema).prefault([]).describe(`Models tried in order when the ${role} one fails.`);

const priceSchema = z.strictObject({
  inputPerMTokUsd: usdSchema.describe("US dollars per million input tokens."),
  outputPerMTokUsd: usdSchema.describe("US dollars per million output tokens."),
  cachedPerMTokUsd: usdSchema.describe("US dollars per million cached input tokens."),
});

/** Parses `models`. */
export const modelsSchema: z.ZodType<ModelsConfig> = z
  .strictObject({
    providers: z
      .record(z.string().min(1), providerSchema)
      .prefault({})
      .meta({ description: "The model providers, by name.", keyName: "provider" }),
    main: modelRole("talks and proposes"),
    fast: modelRole("writes summaries, compacts and classifies"),
    vision: modelRole("reads images when the main one cannot"),
    fallbacks: z
      .strictObject({ main: fallbackList("main"), fast: fallbackList("fast") })
      .prefault({})
      .describe("Fallback models per role."),
    idleTimeoutMs: z
      .int()
      .positive()
      .prefault(120_000)
      .describe("No output for this many milliseconds aborts a model request."),
    cooldownMs: z
      .int()
      .positive()
      .prefault(60_000)
      .describe("How long a failing provider rests, in milliseconds."),
    maxToolCallsPerTurn: z.int().positive().prefault(25).describe("Tool calls allowed per turn."),
    loopDetection: z.boolean().prefault(true).describe("Stops a turn that repeats its tool calls."),
    prices: z
      .record(modelSchema, priceSchema)
      .prefault({})
      .meta({ description: "Model prices that replace the built-in table.", keyName: "model" }),
  })
  .prefault({})
  .describe("Model providers and the models the agent uses.");
