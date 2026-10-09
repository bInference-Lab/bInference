import type { ShutdownReport } from "@binference/platform";
import type { EngineState } from "@binference/protocol";
import type { ServerAddress } from "@binference/server";
import type { ConfigIssue } from "../config/config-issue.js";
import type { LockReason } from "../unlock/unlock-keys.js";

/** Why the engine did not start, with what the owner needs to fix it. */
export type StartRefusal =
  | { readonly ok: false; readonly refusal: "already_running"; readonly folder: string }
  | {
      readonly ok: false;
      readonly refusal: "config_invalid";
      readonly issues: readonly ConfigIssue[];
    }
  | { readonly ok: false; readonly refusal: "store_damaged"; readonly file: string }
  | { readonly ok: false; readonly refusal: "port_taken"; readonly port: number };

/** A self-hosted engine that serves the protocol until its shutdown sequence ends. */
export interface RunningEngine {
  /** Where the HTTP listener bound: the console, the Mini App and the WebSocket at `/ws`. */
  readonly http: ServerAddress;
  /** The socket path or pipe name the CLI and the agent runtime connect to. */
  readonly ipc: string;
  /** The engine's log file. */
  readonly logFile: string;
  /** `ready`, or `locked` when the unlock mode did not open the agent key (decision 0103). */
  readonly state: EngineState;
  /** Why the engine is locked, when it is. */
  readonly lockReason?: LockReason;
  /** Resolves once the shutdown sequence has ended, with what each step did. */
  readonly finished: Promise<ShutdownReport>;
}

/** A running engine, or why it did not start. */
export type StartOutcome = { readonly ok: true; readonly engine: RunningEngine } | StartRefusal;
