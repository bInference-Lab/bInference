import type { AccountRef, AssetRef } from "@binference/plugin-sdk";
import { type CurveChainSetup, curveTokenOn } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import {
  launchPhase,
  type LaunchRecord,
  numberOf,
  sellableCallData,
} from "../contracts/genius-calls.js";
import { type GeniusRead, readCall } from "../contracts/read-genius.js";
import { factoriesOf } from "../geniusfun-contracts.js";
import type { VenueParts } from "../venue-parts.js";
import { findLaunch } from "./find-launch.js";

/**
 * Where a token stands with Genius.fun now: on the curve of a launch a listed stack made, not
 * graduated and still selling tokens; held with no curve to trade, against the pair its launch
 * names; or off its curve.
 */
export type TokenStanding =
  | {
      readonly kind: "on_curve";
      readonly setup: CurveChainSetup;
      readonly read: GeniusRead;
      readonly launch: LaunchRecord;
    }
  | {
      readonly kind: "held";
      /**
       * Why no curve trades it: a stack the registry does not list launched it, or its launch is
       * graduating, its curve ready to graduate or swept, and its pool not made yet.
       */
      readonly why: "unknown_stack" | "graduating";
      readonly setup: CurveChainSetup;
      readonly pairToken: Address;
    }
  | { readonly kind: "off_curve" };

const offCurve: TokenStanding = { kind: "off_curve" };

// A launch whose pool exists, or whose reserves the stack's owner rescued for good, trades in the
// pools from now on; any other phase that is not on the curve is still graduating.
const settledPhases: ReadonlySet<number> = new Set([launchPhase.poolCreated, launchPhase.rescued]);

/**
 * Reads where a token stands at the latest block: its launch from every live stack's factory, and,
 * for a launch not graduated, whether its curve still sells tokens. A launch whose curve is ready
 * to graduate, or swept before its pool is made, is `held` as graduating, so its trades go nowhere
 * until the pool exists (decision 0179); one with its pool, or rescued, is `off_curve`. A token a
 * stack the registry does not list says it launched is `held` until that stack says its pool
 * exists or it was rescued, and then `off_curve`, so its pool takes it. An asset that is no ERC-20
 * token of a chain the venue trades on, and a token never launched, are `off_curve`. A launch on
 * its curve is kept for the decoder. A contract that cannot be read throws, and an aborted signal
 * rejects with its reason.
 */
export async function standingOf(
  asked: { readonly token: AssetRef; readonly contracts: Readonly<Record<string, AccountRef>> },
  parts: VenueParts,
  signal: AbortSignal,
): Promise<TokenStanding> {
  signal.throwIfAborted();
  const held = curveTokenOn(asked.token, parts.setups);
  if (held === undefined) {
    return offCurve;
  }
  const { setup, token } = held;
  const read = { rpc: setup.rpc, signal };
  const finding = await findLaunch(read, factoriesOf(asked.contracts), token);
  if (finding.kind !== "launched") {
    return finding.kind === "unknown_stack" && !settledPhases.has(finding.phase)
      ? { kind: "held", why: "unknown_stack", setup, pairToken: finding.pairToken }
      : offCurve;
  }
  const { launch } = finding;
  if (settledPhases.has(launch.phase)) {
    return offCurve;
  }
  const supply = { to: launch.curve, data: sellableCallData, what: "the curve's supply" };
  if (
    launch.phase !== launchPhase.notGraduated ||
    (await readCall(read, supply, numberOf)) === 0n
  ) {
    return { kind: "held", why: "graduating", setup, pairToken: launch.pairToken };
  }
  parts.launches.set(launch.curve, { token, pairToken: launch.pairToken });
  return { kind: "on_curve", setup, read, launch };
}
