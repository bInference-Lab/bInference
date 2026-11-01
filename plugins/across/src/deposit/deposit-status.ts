import {
  BinferenceError,
  type BridgeDestination,
  type DepositRef,
  type DepositState,
  type DepositStatus,
  isTxHash,
  type TxHash,
} from "@binference/plugin-sdk";
import { eip155ChainIdOf } from "@binference/plugin-sdk/evm";
import { type Hex, isHex } from "viem";
import type { AcrossApi } from "../api/across-api.js";
import type { AcrossDepositAnswer } from "../api/status-answer.schema.js";

/** Across's page for a deposit, by its transaction on the source chain. */
export function statusUrlOf(hash: string): string {
  return `https://across.to/transfer/${hash}`;
}

function badAnswer(): BinferenceError {
  return new BinferenceError({
    code: "across.unavailable",
    message: "Across's deposit status names another deposit or a chain the bridge does not serve.",
    retryable: true,
  });
}

function stateOf(
  answer: AcrossDepositAnswer,
  deposit: DepositRef,
  destinations: readonly BridgeDestination[],
): DepositState {
  const destination = destinations.find((item) => item.id === answer.destinationChainId.toString());
  const isOwn =
    answer.depositTxHash === deposit.hash.toLowerCase() &&
    answer.originChainId === BigInt(eip155ChainIdOf(deposit.chain) ?? 0);
  if (!isOwn || destination === undefined) {
    throw badAnswer();
  }
  if (answer.status === "filled") {
    return { kind: "filled", fill: { chain: destination.chain, hash: txHashOf(answer.fillTx) } };
  }
  if (answer.status === "refunded") {
    const refund = { chain: deposit.chain, hash: txHashOf(answer.depositRefundTxHash) };
    return { kind: "refunded", refund };
  }
  return { kind: answer.status };
}

// The status schema reads a filled deposit only with its fill, and a refunded one with its refund.
function txHashOf(hash: Hex | undefined): TxHash {
  if (hash === undefined || !isTxHash(hash)) {
    throw badAnswer();
  }
  return hash;
}

// A deposit on an EVM chain is named by its 32-byte transaction hash.
function depositHashOf(deposit: DepositRef): Hex {
  const { hash } = deposit;
  if (!isHex(hash) || hash.length !== 66) {
    throw new BinferenceError({
      code: "across.not_evm",
      message: "Across's deposits on this chain are EVM transactions, named by a 32-byte hash.",
    });
  }
  return hash;
}

/**
 * Where an Across deposit stands by Across's word, read by its transaction: `unseen` until Across's
 * indexer saw it (1 to 15 seconds after it lands, by Across's docs), then pending, filled with the
 * fill's transaction on the destination chain, expired past its fill deadline, or refunded with
 * the refund's transaction on the source chain. An answer about another deposit, or a fill on a
 * chain the bridge does not serve, throws `across.unavailable`.
 */
export async function depositStatus(
  deposit: DepositRef,
  parts: { readonly api: AcrossApi; readonly destinations: readonly BridgeDestination[] },
  signal: AbortSignal,
): Promise<DepositStatus> {
  signal.throwIfAborted();
  const answer = await parts.api.deposit(depositHashOf(deposit), signal);
  const state: DepositState =
    answer === "unseen" ? { kind: "unseen" } : stateOf(answer, deposit, parts.destinations);
  return { state, statusUrl: statusUrlOf(deposit.hash) };
}
