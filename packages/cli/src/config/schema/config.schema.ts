import { z } from "zod";
import {
  type ChainsConfig,
  chainsSchema,
  type RiskConfig,
  riskSchema,
  type SearchConfig,
  searchSchema,
  type VenuesConfig,
  venuesSchema,
} from "./chains-venues.schema.js";
import { type AgentDefaultsConfig, agentDefaultsSchema } from "./defaults.schema.js";
import {
  type CustodyConfig,
  custodySchema,
  type EngineConfig,
  engineSchema,
  type OwnerConfig,
  ownerSchema,
} from "./engine.schema.js";
import {
  type BackupsConfig,
  backupsSchema,
  type CexConfig,
  cexSchema,
  type ChatsConfig,
  chatsSchema,
  type LoggingConfig,
  loggingSchema,
  type NetworkConfig,
  networkSchema,
  type PluginsConfig,
  pluginsSchema,
  type RemoteConfig,
  remoteSchema,
  type TelemetryConfig,
  telemetrySchema,
  type UpdatesConfig,
  updatesSchema,
} from "./operations.schema.js";
import {
  type ModelsConfig,
  modelsSchema,
  type TelegramConfig,
  telegramSchema,
} from "./telegram-models.schema.js";

/**
 * A self-hosted install's `config.json5` after every layer and default: what an owner sets once
 * for the install. Dollar values are `bigint` micro-dollars; secrets are sources, never values.
 */
export interface BinferenceConfig {
  /** The shape of the file, raised by each config migration. */
  readonly version: number;
  readonly owner: OwnerConfig;
  readonly engine: EngineConfig;
  readonly custody: CustodyConfig;
  readonly telegram: TelegramConfig;
  readonly models: ModelsConfig;
  readonly defaults: AgentDefaultsConfig;
  readonly chains: ChainsConfig;
  readonly venues: VenuesConfig;
  readonly risk: RiskConfig;
  readonly search: SearchConfig;
  readonly remote: RemoteConfig;
  readonly backups: BackupsConfig;
  readonly updates: UpdatesConfig;
  readonly telemetry: TelemetryConfig;
  readonly network: NetworkConfig;
  readonly chats: ChatsConfig;
  readonly logging: LoggingConfig;
  readonly cex: CexConfig;
  readonly plugins: PluginsConfig;
}

/** What a cross-key rule adds to a zod issue, so it maps to a `required` problem. */
export const requiredParams: { readonly problem: "required" } = { problem: "required" };

// Keys that one value of another key makes required.
function requireTogether(config: BinferenceConfig, context: z.RefinementCtx): void {
  if (config.engine.unlock.mode === "command" && config.engine.unlock.command === undefined) {
    context.addIssue({
      code: "custom",
      path: ["engine", "unlock", "command"],
      message: "Required when engine.unlock.mode is command.",
      params: requiredParams,
    });
  }
  if (config.telegram.mode === "webhook" && config.telegram.webhookSecret === undefined) {
    context.addIssue({
      code: "custom",
      path: ["telegram", "webhookSecret"],
      message: "Required when telegram.mode is webhook.",
      params: requiredParams,
    });
  }
}

/** The one strict schema of `config.json5`: unknown keys are refused, every key is described. */
export const configSchema: z.ZodType<BinferenceConfig> = z
  .strictObject({
    version: z.int().positive().prefault(1).describe("The shape of this file."),
    owner: ownerSchema,
    engine: engineSchema,
    custody: custodySchema,
    telegram: telegramSchema,
    models: modelsSchema,
    defaults: agentDefaultsSchema,
    chains: chainsSchema,
    venues: venuesSchema,
    risk: riskSchema,
    search: searchSchema,
    remote: remoteSchema,
    backups: backupsSchema,
    updates: updatesSchema,
    telemetry: telemetrySchema,
    network: networkSchema,
    chats: chatsSchema,
    logging: loggingSchema,
    cex: cexSchema,
    plugins: pluginsSchema,
  })
  .superRefine(requireTogether)
  .describe("The binference config file.");
