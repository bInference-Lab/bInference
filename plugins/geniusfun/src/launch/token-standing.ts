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
 * graduated and still selling tokens; launched by a stack the registry does not list, against the
 * pair that stack names; or neither.
 */
export type TokenStanding =
  | {
      readonly kind: "on_curve";
      readonly setup: CurveChainSetup;
      readonly read: GeniusRead;
      readonly launch: LaunchRecord;
    }
  | { readonly kind: "unknown_stack"; readonly setup: CurveChainSetup; readonly pairToken: Address }
  | { readonly kind: "off_curve" };

const offCurve: TokenStanding = { kind: "off_curve" };

/**
 * Reads where a token stands at the latest block: its launch from every live stack's factory, and,
 * for a launch not graduated, whether its curve still sells tokens. An asset that is no ERC-20
 * token of a chain the venue trades on, a token never launched, a graduated one, and one whose
 * curve is ready to graduate are `off_curve`. A launch on its curve is kept for the decoder. A
 * contract that cannot be read throws, and an aborted signal rejects with its reason.
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
    return finding.kind === "unknown_stack"
      ? { kind: "unknown_stack", setup, pairToken: finding.pairToken }
      : offCurve;
  }
  const { launch } = finding;
  const supply = { to: launch.curve, data: sellableCallData, what: "the curve's supply" };
  if (
    launch.phase !== launchPhase.notGraduated ||
    (await readCall(read, supply, numberOf)) === 0n
  ) {
    return offCurve;
  }
  parts.launches.set(launch.curve, { token, pairToken: launch.pairToken });
  return { kind: "on_curve", setup, read, launch };
}
