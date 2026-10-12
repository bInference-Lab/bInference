import { BinferenceError } from "@binference/core";
import {
  type AssetInfo,
  type AssetInfos,
  assetInfosSchema,
  type IntentState,
  type ProtocolErrorCode,
  protocolErrorCodes,
} from "@binference/protocol";
import type { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";

// Codes that may reach a call without the engine having answered it: a `bye` that closed the
// connection with the call in flight, or an engine fault after the write began. Its outcome is
// not known, so a proposal that ends with one is never taken as refused.
const uncertainAreas: ReadonlySet<string> = new Set(["auth", "engine", "internal", "runtime"]);
const uncertainCodes: ReadonlySet<string> = new Set<ProtocolErrorCode>([
  "protocol.version",
  "protocol.bad_frame",
  "protocol.not_open",
]);

const engineCodes: ReadonlySet<string> = new Set(protocolErrorCodes);

/** The states a fresh proposal ends in when the engine refused it by its checks. */
const refusedStates: ReadonlySet<IntentState> = new Set<IntentState>([
  "rejected_policy",
  "risk_blocked",
  "failed_check",
]);

/** Whether the engine refused a fresh intent by its policy, risk or checks. */
export function isRefusedState(state: IntentState): boolean {
  return refusedStates.has(state);
}

/**
 * Whether an error is the engine's own answer that refused a call, from its `fail` frame, so the
 * call did nothing. Not for anything uncertain: the client's own failures and timeouts, a
 * connection the engine closed, the engine's own faults.
 */
export function isEngineRefusal(error: BinferenceError): boolean {
  const area = error.code.slice(0, error.code.indexOf("."));
  return (
    engineCodes.has(error.code) && !uncertainAreas.has(area) && !uncertainCodes.has(error.code)
  );
}

/** A failed call as the model reads it: the tool, the error's code and the engine's message. */
export function failedAnswer(tool: string, error: BinferenceError): ToolOutcome {
  return { text: `${tool} failed with ${error.code}: ${error.message}`, isError: true };
}

/**
 * Runs a read or control call's engine work; an error with a code becomes a result the model
 * reads, and any other error stays a fault of the call.
 */
export async function answerOrFailure(
  tool: string,
  work: () => Promise<ToolOutcome>,
): Promise<ToolOutcome> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BinferenceError) {
      return failedAnswer(tool, error);
    }
    throw error;
  }
}

/**
 * A result as the model reads it: the engine's JSON for it, with amounts as decimal strings of
 * base units, as the protocol encodes them.
 */
export function jsonOf<Result>(schema: z.ZodType<Result>, result: Result): string {
  return JSON.stringify(schema.encode(result));
}

const unlisted = "unlisted token";

function shown(info: AssetInfo): AssetInfo {
  return info.verified
    ? info
    : { symbol: unlisted, name: unlisted, decimals: info.decimals, verified: false };
}

/**
 * The assets of a result with every token the registry does not list shown by its address and the
 * words "unlisted token": its deployer chose its name and symbol, so they are outside content,
 * which only `token_info` shows (runtime spec, section 5.4).
 */
export function withUnlistedHidden(assets: AssetInfos): AssetInfos {
  const entries = Object.entries(assets).map(([asset, info]) => [asset, shown(info)] as const);
  return assetInfosSchema.parse(Object.fromEntries(entries));
}
