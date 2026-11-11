import { isBypassEntry } from "@binference/core";
import { z } from "zod";
import { type JsonObject, jsonValueSchema } from "../json-value.schema.js";
import { type SecretSource, secretSourceSchema } from "./secret-source.schema.js";
import { formatted, pathSchema } from "./value-formats.schema.js";

/** What Tailscale publishes, and where the owner's own HTTPS publishes the engine's port. */
export interface RemoteConfig {
  /** Whether `binference expose` published the Mini App; it records, never publishes (decision 0341). */
  readonly mini: boolean;
  /** Whether `binference expose --webhooks` published the webhook path; a record too. */
  readonly webhooks: boolean;
  /** The HTTPS origin of the engine's port, such as a Tailscale `serve` address. */
  readonly publicUrl?: string;
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

/**
 * The agent's shell (decisions 0378 and 0409): what it runs, when a command asks the owner first,
 * what an unanswered request does, a command's time limit, and whether a quiet end wakes the agent.
 */
export interface ShellConfig {
  readonly run: "off" | "listed" | "any";
  readonly ask: "never" | "unlisted" | "always";
  readonly onNoAnswer: "refuse" | "listed" | "any";
  /** A command's time limit in seconds when the agent names none; 0 for none. */
  readonly timeoutSeconds: number;
  readonly tellOnQuietEnd: boolean;
}

/** Where the agent's file tools reach (decision 0386); binference's own folder never. */
export interface FilesConfig {
  readonly workspaceOnly: boolean;
  readonly patchWorkspaceOnly: boolean;
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
    mini: off(
      "Whether binference expose published the Mini App over Tailscale serve; a record, so changing it publishes nothing.",
    ),
    webhooks: off(
      "Whether binference expose --webhooks published the webhook path over Tailscale funnel; a record, so changing it publishes nothing.",
    ),
    publicUrl: formatted("https_origin")
      .exactOptional()
      .describe(
        "The HTTPS address where the owner's own proxy publishes the engine's port: /console opens its /mini in Telegram, and its origin may open the engine's socket, the console and the Mini App's image uploads, never pairing; it must serve nothing else.",
      ),
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

// As many entries as the agent runtime's settings line carries, each as long.
const maxNoProxyEntries = 256;
const maxNoProxyEntryChars = 300;

const isNoProxyEntry = (entry: string): boolean =>
  entry.length <= maxNoProxyEntryChars && isBypassEntry(entry);

const noProxyEntryMessage =
  "A no-proxy entry is *, a name in punycode, an IP address or [IPv6], each with an optional :port, or an address block such as 10.0.0.0/8.";

/** Parses `network`. */
export const networkSchema: z.ZodType<NetworkConfig> = z
  .strictObject({
    proxy: secretSourceSchema
      .exactOptional()
      .describe(
        "The owner's proxy as an http:// or https:// URL, its user name and password included: every outbound request but those to this machine, addresses off the internet and noProxy goes through it as a tunnel.",
      ),
    noProxy: z
      .array(z.string().min(1).refine(isNoProxyEntry, noProxyEntryMessage))
      .refine(
        (list) => list.length <= maxNoProxyEntries,
        "network.noProxy takes at most 256 entries.",
      )
      .prefault(["127.0.0.1", "localhost"])
      .describe(
        "Hosts reached without the proxy, at most 256: * for every host, a name in punycode that also covers the names under it, an IP address or [IPv6], each with an optional :port, or an address block such as 10.0.0.0/8.",
      ),
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

/** Parses `shell`. */
export const shellSchema: z.ZodType<ShellConfig> = z
  .strictObject({
    run: z
      .enum(["off", "listed", "any"])
      .prefault("any")
      .describe(
        "any lets the agent run commands on this machine, away from binference's own folder; " +
          "listed runs only the commands you allowed always; off runs none.",
      ),
    ask: z
      .enum(["never", "unlisted", "always"])
      .prefault("never")
      .describe(
        "When a command waits for your Allow once, Always allow or Refuse: never, for each " +
          "command not allowed always (unlisted), or for every command (always).",
      ),
    onNoAnswer: z
      .enum(["refuse", "listed", "any"])
      .prefault("refuse")
      .describe(
        "What a shell request you leave 10 minutes unanswered does: refuse runs nothing, listed " +
          "runs it only when it is allowed by then, any runs it; never more than shell.run allows.",
      ),
    timeoutSeconds: z
      .int()
      .min(0)
      .max(86_400)
      .prefault(1_800)
      .describe("A command's time limit in seconds when the agent names none; 0 for none."),
    tellOnQuietEnd: z
      .boolean()
      .prefault(false)
      .describe(
        "true also wakes the agent when a command it left running ends with exit code 0 and " +
          "printed nothing new; false leaves such an end quiet.",
      ),
  })
  .prefault({})
  .describe("The agent's shell.");

/** Parses `files`. */
export const filesSchema: z.ZodType<FilesConfig> = z
  .strictObject({
    workspaceOnly: z
      .boolean()
      .prefault(false)
      .describe(
        "true keeps the agent's file reads, writes and edits inside its workspace; false lets " +
          "them reach any file but binference's own folder.",
      ),
    patchWorkspaceOnly: z
      .boolean()
      .prefault(true)
      .describe(
        "true keeps the agent's patches inside its workspace; false lets them change any file " +
          "but binference's own folder.",
      ),
  })
  .prefault({})
  .describe("Where the agent's file tools reach.");

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
