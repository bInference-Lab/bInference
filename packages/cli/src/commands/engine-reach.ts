import type { ProtocolClient } from "@binference/client";
import { connectEngine, type EngineConnection } from "./connect-engine.js";
import type { InstallCheck } from "./install-findings.js";

/** What a check reads the engine with: its calls, and a close once the check has read it. */
type EngineReader = Pick<ProtocolClient, "call" | "close">;

/** A reader of the engine, or why there is none, as `connectEngine` says it. */
export type EngineReading =
  | { readonly ok: true; readonly client: EngineReader }
  | Exclude<EngineConnection, { readonly ok: true }>;

/**
 * How the findings of `binference check` reach the engine: the CLI's sign-in over IPC, or, for
 * `check/run`, the engine's own handlers in its own process (decision 0445).
 */
export type EngineReach = (signal: AbortSignal) => Promise<EngineReading>;

/** The reach a check names, else the CLI's sign-in over the host's IPC endpoint. */
export function reachOf(options: InstallCheck): EngineReach {
  return options.reach ?? (async (signal) => connectEngine(options.host, signal));
}
