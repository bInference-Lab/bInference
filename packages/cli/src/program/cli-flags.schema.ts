import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { z } from "zod";
import type { UnlockMode } from "../config/schema/engine.schema.js";

/** What every command takes: `--json` for scripts, `--yes` for questions. */
export interface CommonOptions {
  readonly json: boolean;
  readonly yes: boolean;
}

/** What `start` takes besides the common options. */
export interface StartFlags extends CommonOptions {
  /** Each `--set key=value`, in the order given. */
  readonly sets: readonly string[];
}

/** What `logs` takes besides the common options. */
export interface LogsFlags extends CommonOptions {
  readonly lines: number;
  readonly follow: boolean;
}

/** What a command on one agent takes: the agent `--agent` names, or the only one when left out. */
export interface AgentFlags extends CommonOptions {
  readonly agent?: ProtocolId<"agent">;
}

/** What `wallet address` takes: the agent, and the wallet `--wallet` names. */
export interface WalletAddressFlags extends AgentFlags {
  /** The agent's default wallet when left out. */
  readonly wallet?: ProtocolId<"wallet">;
}

/** What `check` takes: `--fix` repairs what the check may repair. */
export interface CheckFlags extends CommonOptions {
  readonly fix: boolean;
}

/**
 * What `init` takes besides the common options. Secrets come as secret sources written as in
 * `config.json5`, never as values on the command line.
 */
export interface InitFlags extends CommonOptions {
  readonly privyAppId?: string;
  /** The Privy app secret's source, such as `{ fromEnv: "PRIVY_APP_SECRET" }`. */
  readonly privyAppSecret?: string;
  /** The bot token's source. */
  readonly botToken?: string;
  /** The rescue address. */
  readonly rescue?: string;
  readonly unlock?: UnlockMode;
  /** The `{ fromCommand: [...] }` that prints the agent key, for the `command` unlock mode. */
  readonly unlockCommand?: string;
  /** Each `--set key=value` for the config file, in the order given. */
  readonly sets: readonly string[];
  /** Sets up a folder that was set up before, with a new owner key and a new wallet. */
  readonly isStartOver: boolean;
}

/** The most lines `logs --lines` takes. */
export const maxLogLines = 10_000;

const commonShape = {
  json: z.boolean().default(false),
  yes: z.boolean().default(false),
};

/** Parses the options commander read for `status` and `health`. */
export const commonFlagsSchema: z.ZodType<CommonOptions> = z.object(commonShape);

/** Parses the options commander read for `start`. */
export const startFlagsSchema: z.ZodType<StartFlags> = z
  .object({ ...commonShape, set: z.array(z.string()).default([]) })
  .transform(({ set, ...common }) => ({ ...common, sets: set }));

/** Parses the options commander read for a command on one agent. */
export const agentFlagsSchema: z.ZodType<AgentFlags> = z.object({
  ...commonShape,
  agent: protocolIdSchema("agent").exactOptional(),
});

/** Parses the options commander read for `wallet address`. */
export const walletAddressFlagsSchema: z.ZodType<WalletAddressFlags> = z.object({
  ...commonShape,
  agent: protocolIdSchema("agent").exactOptional(),
  wallet: protocolIdSchema("wallet").exactOptional(),
});

/** Parses the options commander read for `check`. */
export const checkFlagsSchema: z.ZodType<CheckFlags> = z.object({
  ...commonShape,
  fix: z.boolean().default(false),
});

/** Parses the options commander read for `logs`; 100 lines unless `--lines` says otherwise. */
export const logsFlagsSchema: z.ZodType<LogsFlags> = z.object({
  ...commonShape,
  lines: z.int().min(1).max(maxLogLines).default(100),
  follow: z.boolean().default(false),
});

/** Parses the options commander read for `init`; commander leaves an option it did not see out. */
export const initFlagsSchema: z.ZodType<InitFlags> = z
  .object({
    ...commonShape,
    privyAppId: z.string().min(1).exactOptional(),
    privyAppSecret: z.string().min(1).exactOptional(),
    botToken: z.string().min(1).exactOptional(),
    rescue: z.string().min(1).exactOptional(),
    unlock: z.enum(["keychain", "file", "manual", "command"]).exactOptional(),
    unlockCommand: z.string().min(1).exactOptional(),
    set: z.array(z.string()).default([]),
    startOver: z.boolean().default(false),
  })
  .transform(({ set, startOver, ...rest }) => ({ ...rest, sets: set, isStartOver: startOver }));
