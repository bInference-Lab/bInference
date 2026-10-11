import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { z } from "zod";
import type { UnlockMode } from "../config/schema/engine.schema.js";

/** What every command takes: `--json` for scripts, `--yes` for questions. */
export interface CommonOptions {
  readonly json: boolean;
  readonly yes: boolean;
}

/** What `start` and `restart` take besides the common options. */
export interface StartFlags extends CommonOptions {
  /** Each `--set key=value`, in the order given. */
  readonly sets: readonly string[];
  /** `--foreground`: run the engine in this process rather than as the background service. */
  readonly isForeground: boolean;
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

/** What `ceiling set` takes: the wallet, and the venues and the cap to set on its agent's ceilings. */
export interface CeilingSetFlags extends WalletAddressFlags {
  /** Every venue a contract call may use, each as the registry names it. */
  readonly venues?: readonly string[];
  /** The most native coin one contract call may carry, such as `0.5`, as `perTxBnb` in config. */
  readonly perTx?: string;
  /** The size of every 24-hour cap in US dollars at its floor price, such as `2000`. */
  readonly dayCapUsd?: string;
}

/** What `address add` and `wallet create` take: the agent, and the label `--label` gives. */
export interface LabelFlags extends AgentFlags {
  readonly label: string;
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
  /**
   * The owner key's public half, made on a machine with a terminal by `owner-key create`: DER
   * SubjectPublicKeyInfo in base64. Init then makes no owner key and shows no code.
   */
  readonly ownerKeyPublic?: string;
  readonly unlock?: UnlockMode;
  /** The `{ fromCommand: [...] }` that prints the agent key, for the `command` unlock mode. */
  readonly unlockCommand?: string;
  /** Each `--set key=value` for the config file, in the order given. */
  readonly sets: readonly string[];
  /** Sets up a folder that was set up before, with a new owner key and a new wallet. */
  readonly isStartOver: boolean;
  /**
   * Makes this machine's new agent key the signer of the install's wallets, with the owner key
   * (keys spec, section 6), in place of the key that signed for them.
   */
  readonly isAttach: boolean;
  /** With `isAttach`: the backup file restored first, opened with the owner key (keys spec, 7.4). */
  readonly restore?: string;
}

/** The most lines `logs --lines` takes. */
export const maxLogLines = 10_000;

const commonShape = {
  json: z.boolean().default(false),
  yes: z.boolean().default(false),
};

/** Parses the options commander read for `status` and `health`. */
export const commonFlagsSchema: z.ZodType<CommonOptions> = z.object(commonShape);

/** Parses the options commander read for `start` and `restart`. */
export const startFlagsSchema: z.ZodType<StartFlags> = z
  .object({
    ...commonShape,
    set: z.array(z.string()).default([]),
    foreground: z.boolean().default(false),
  })
  .transform(({ set, foreground, ...common }) => ({
    ...common,
    sets: set,
    isForeground: foreground,
  }));

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

/** Parses the options of `ceiling set`; `--venues` arrives split at its commas. */
export const ceilingSetFlagsSchema: z.ZodType<CeilingSetFlags> = z.object({
  ...commonShape,
  agent: protocolIdSchema("agent").exactOptional(),
  wallet: protocolIdSchema("wallet").exactOptional(),
  venues: z.array(z.string().min(1).max(64)).min(1).exactOptional(),
  perTx: z.string().min(1).max(64).exactOptional(),
  dayCapUsd: z.string().min(1).max(64).exactOptional(),
});

/** Parses the options of `address add` and `wallet create`; a label is 1 to 64 characters. */
export const labelFlagsSchema: z.ZodType<LabelFlags> = z.object({
  ...commonShape,
  agent: protocolIdSchema("agent").exactOptional(),
  label: z.string().min(1).max(64),
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
    ownerKeyPublic: z.string().min(1).max(512).exactOptional(),
    unlock: z.enum(["keychain", "file", "manual", "command"]).exactOptional(),
    unlockCommand: z.string().min(1).exactOptional(),
    set: z.array(z.string()).default([]),
    startOver: z.boolean().default(false),
    attach: z.boolean().default(false),
    restore: z.string().min(1).exactOptional(),
  })
  .transform(({ set, startOver, attach, ...rest }) => ({
    ...rest,
    sets: set,
    isStartOver: startOver,
    isAttach: attach,
  }));
