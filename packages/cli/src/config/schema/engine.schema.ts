import { type Locale, localeSchema } from "@binference/protocol";
import { z } from "zod";
import {
  type CommandSource,
  commandSourceSchema,
  type SecretSource,
  secretSourceSchema,
} from "./secret-source.schema.js";
import { formatted, portSchema } from "./value-formats.schema.js";

/** The owner's language and time zone. */
export interface OwnerConfig {
  readonly locale: Locale;
  /** An IANA zone such as `Asia/Shanghai`. */
  readonly timezone: string;
}

/** Where the agent key and the Privy app secret are read at start. */
export type UnlockMode = "keychain" | "file" | "manual" | "command";

/** How the engine unlocks the agent key and the Privy app secret. */
export interface UnlockConfig {
  readonly mode: UnlockMode;
  /** The command that prints them, used when `mode` is `command`. */
  readonly command?: CommandSource;
}

/** The engine process: its ports, origins, unlock mode and shutdown budget. */
export interface EngineConfig {
  readonly port: number;
  readonly webhookPort: number;
  readonly extraOrigins: readonly string[];
  readonly unlock: UnlockConfig;
  readonly shutdownBudgetMs: number;
}

/** The owner's Privy app. */
export interface PrivyConfig {
  readonly appId?: string;
  readonly appSecret?: SecretSource;
  readonly ownerKeyPublic?: string;
}

/** Who holds the agent wallets: Privy, the only custody provider. */
export interface CustodyConfig {
  readonly provider: "privy";
  readonly privy: PrivyConfig;
}

/** Parses `owner`. Both keys default to what the OS reports. */
export const ownerSchema: z.ZodType<OwnerConfig> = z
  .strictObject({
    locale: localeSchema
      .prefault("en")
      .meta({ description: "The language of every surface.", defaultText: "from the OS" }),
    timezone: formatted("time_zone").prefault("UTC").meta({
      description: "The IANA time zone for schedules, the daily summary and times shown.",
      defaultText: "from the OS",
    }),
  })
  .prefault({})
  .describe("The owner.");

const unlockSchema = z
  .strictObject({
    mode: z.enum(["keychain", "file", "manual", "command"]).prefault("file").meta({
      description: "Where the agent key and the Privy app secret are read at start.",
      defaultText: "keychain with a desktop session, else file",
    }),
    command: commandSourceSchema
      .exactOptional()
      .describe("The command that prints the agent key; used when mode is command."),
  })
  .prefault({})
  .describe("How the engine unlocks the agent key at start.");

/** Parses `engine`. */
export const engineSchema: z.ZodType<EngineConfig> = z
  .strictObject({
    port: portSchema.prefault(7456).describe("The console, Mini App and WebSocket port."),
    webhookPort: portSchema.prefault(7457).describe("The webhook listener's port."),
    extraOrigins: z
      .array(z.url())
      .prefault([])
      .describe("More browser origins allowed to reach the engine."),
    unlock: unlockSchema,
    shutdownBudgetMs: z
      .int()
      .min(1000)
      .prefault(30_000)
      .describe("The time limit of the shutdown order, in milliseconds."),
  })
  .prefault({})
  .describe("The engine process.");

/** Parses `custody`. */
export const custodySchema: z.ZodType<CustodyConfig> = z
  .strictObject({
    provider: z.literal("privy").prefault("privy").describe("The custody provider."),
    privy: z
      .strictObject({
        appId: z.string().min(1).exactOptional().describe("The owner's Privy app id (public)."),
        appSecret: secretSourceSchema
          .exactOptional()
          .describe("The owner's Privy app secret, as a secret source."),
        ownerKeyPublic: z
          .string()
          .min(1)
          .exactOptional()
          .describe("The owner key's public half, written by binference init."),
      })
      .prefault({})
      .describe("The owner's Privy app."),
  })
  .prefault({})
  .describe("Who holds the agent wallets.");
