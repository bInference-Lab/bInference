import { z } from "zod";
import { type JsonObject, jsonValueSchema } from "../json-value.schema.js";
import { type SecretSource, secretSourceSchema } from "./secret-source.schema.js";
import { pathSchema } from "./value-formats.schema.js";

/** What Tailscale publishes. */
export interface RemoteConfig {
  readonly mini: boolean;
  readonly webhooks: boolean;
}

/** Daily encrypted backups. */
export interface BackupsConfig {
  readonly daily: boolean;
  readonly keepDaily: number;
  readonly keepWeekly: number;
  /** A folder that gets a second copy. */
  readonly copyTo?: string;
}

/** The daily update check. */
export interface UpdatesConfig {
  readonly check: boolean;
  readonly channel: "stable" | "beta";
}

/** The outbound proxy. */
export interface NetworkConfig {
  readonly proxy?: SecretSource;
  readonly noProxy: readonly string[];
}

/** How long chats are kept and how a message during a turn is handled. */
export interface ChatsConfig {
  readonly keepDays: number | "forever";
  readonly newMessageMode: "merge" | "after";
}

/** The log level and log files. */
export interface LoggingConfig {
  readonly level: "error" | "warn" | "info" | "debug";
  readonly keepDays: number;
  readonly maxFileMb: number;
}

/** Opt-in telemetry. */
export interface TelemetryConfig {
  readonly enabled: boolean;
}

/** Centralized exchanges. */
export interface CexConfig {
  readonly binance: { readonly enabled: boolean };
}

/** Each plugin's settings by plugin id, checked by the plugin's own schema when it loads. */
export type PluginsConfig = Readonly<Record<string, JsonObject>>;

const count = (fallback: number, description: string) =>
  z.int().positive().prefault(fallback).describe(description);

const on = (description: string) => z.boolean().prefault(true).describe(description);

const off = (description: string) => z.boolean().prefault(false).describe(description);

/** Parses `remote`. */
export const remoteSchema: z.ZodType<RemoteConfig> = z
  .strictObject({
    mini: off("Publishes the Mini App over Tailscale serve."),
    webhooks: off("Publishes the webhook path over Tailscale funnel."),
  })
  .prefault({})
  .describe("Remote access.");

/** Parses `backups`. */
export const backupsSchema: z.ZodType<BackupsConfig> = z
  .strictObject({
    daily: on("Takes an encrypted backup every day."),
    keepDaily: count(7, "Daily backups kept."),
    keepWeekly: count(4, "Weekly backups kept."),
    copyTo: pathSchema.exactOptional().describe("A folder that gets a second copy."),
  })
  .prefault({})
  .describe("Backups.");

/** Parses `updates`. */
export const updatesSchema: z.ZodType<UpdatesConfig> = z
  .strictObject({
    check: on("Checks for a newer version once a day."),
    channel: z.enum(["stable", "beta"]).prefault("stable").describe("The release channel."),
  })
  .prefault({})
  .describe("Updates.");

/** Parses `telemetry`. */
export const telemetrySchema: z.ZodType<TelemetryConfig> = z
  .strictObject({ enabled: off("Adds opt-in counts to the daily update check.") })
  .prefault({})
  .describe("Telemetry.");

/** Parses `network`. */
export const networkSchema: z.ZodType<NetworkConfig> = z
  .strictObject({
    proxy: secretSourceSchema
      .exactOptional()
      .describe("An HTTP or HTTPS proxy URL, credentials included."),
    noProxy: z
      .array(z.string().min(1))
      .prefault(["127.0.0.1", "localhost"])
      .describe("Hosts reached without the proxy."),
  })
  .prefault({})
  .describe("The outbound network.");

/** Parses `chats`. */
export const chatsSchema: z.ZodType<ChatsConfig> = z
  .strictObject({
    keepDays: z
      .union([z.int().positive(), z.literal("forever")])
      .prefault(90)
      .describe("Days chats are kept, or forever."),
    newMessageMode: z
      .enum(["merge", "after"])
      .prefault("merge")
      .describe("Whether a message during a turn merges in or waits for the turn to end."),
  })
  .prefault({})
  .describe("Chats.");

/** Parses `logging`. */
export const loggingSchema: z.ZodType<LoggingConfig> = z
  .strictObject({
    level: z.enum(["error", "warn", "info", "debug"]).prefault("info").describe("The log level."),
    keepDays: count(14, "Days log files are kept."),
    maxFileMb: count(20, "A log file rotates at this many megabytes."),
  })
  .prefault({})
  .describe("Logs.");

/** Parses `cex`. */
export const cexSchema: z.ZodType<CexConfig> = z
  .strictObject({
    binance: z
      .strictObject({ enabled: off("Turns on the Binance Agent OS plugin.") })
      .prefault({})
      .describe("Binance."),
  })
  .prefault({})
  .describe("Centralized exchanges.");

/** Parses `plugins`. */
export const pluginsSchema: z.ZodType<PluginsConfig> = z
  .record(
    z.string().min(1),
    z.record(z.string(), jsonValueSchema).meta({
      description: "One plugin's settings, as its own schema reads them.",
      keyName: "setting",
    }),
  )
  .prefault({})
  .meta({ description: "Each plugin's settings, by plugin id.", keyName: "plugin" });
