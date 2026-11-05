import { z } from "zod";
import { type SecretSource, secretSourceSchema } from "./secret-source.schema.js";
import { modelSchema, usdSchema } from "./value-formats.schema.js";

/** The owner's Telegram bot. */
export interface TelegramConfig {
  readonly botToken: SecretSource;
  readonly mode: "polling" | "webhook";
  /** Required with the `webhook` mode. */
  readonly webhookSecret?: SecretSource;
  readonly topicsPerAgent: boolean;
  readonly replies: TelegramRepliesConfig;
}

/** How the agent's replies show in the owner's chat while a turn runs (decision 0376). */
interface TelegramRepliesConfig {
  /**
   * `progress`: a status message once work starts, then the answer as a new message. `partial`:
   * the answer grows in one message that becomes the final answer in place.
   */
  readonly stream: "progress" | "partial";
  /**
   * How the model's reasoning shows (decision 0377): `off` not at all, `streamed` while the agent
   * works and gone with the answer, `kept` as a message of its own before the answer.
   */
  readonly reasoning: "off" | "streamed" | "kept";
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
  /** The models that take images as input, each `<provider>/<model>` (decision 0227). */
  readonly imageInput: readonly string[];
  readonly fallbacks: FallbackConfig;
  readonly idleTimeoutMs: number;
  readonly cooldownMs: number;
  readonly maxToolCallsPerTurn: number;
  readonly loopDetection: boolean;
  /** Keyed by `<provider>/<model>`. */
  readonly prices: Readonly<Record<string, ModelPriceConfig>>;
}

const telegramRepliesSchema: z.ZodType<TelegramRepliesConfig> = z
  .strictObject({
    stream: z
      .enum(["progress", "partial"])
      .prefault("progress")
      .describe(
        "progress shows a status message once the agent works, then the answer as a new message; " +
          "partial grows the answer in one message that becomes the answer itself.",
      ),
    reasoning: z
      .enum(["off", "streamed", "kept"])
      .prefault("off")
      .describe(
        "How the model's reasoning shows: off hides it, streamed shows it while the agent works, " +
          "kept sends it as a message of its own before the answer.",
      ),
  })
  .prefault({})
  .describe("How the agent's replies show in Telegram while it works.");

/** Parses `telegram`. */
export const telegramSchema: z.ZodType<TelegramConfig> = z
  .strictObject({
    botToken: secretSourceSchema.describe("The owner's BotFather token."),
    mode: z.enum(["polling", "webhook"]).prefault("polling").describe("How updates arrive."),
    webhookSecret: secretSourceSchema
      .exactOptional()
      .describe("Checks webhook calls; required with the webhook mode."),
    topicsPerAgent: z
      .boolean()
      .prefault(false)
      .describe("One direct-message topic per agent, once the bot has topics turned on."),
    replies: telegramRepliesSchema,
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
    imageInput: z
      .array(modelSchema)
      .prefault([])
      .describe(
        "The models that take images as input; any other model gets the vision model's description.",
      ),
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
