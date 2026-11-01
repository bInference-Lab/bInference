import {
  BinferenceError,
  type BridgeDestination,
  type DepositRef,
  type DepositState,
  type DepositStatus,
  isTxHash,
} from "@binference/plugin-sdk";
import { type Hex, isHex } from "viem";
import type { RelayApi } from "../api/relay-api.js";
import type { RelayRequest, RelayTx } from "../api/request-answer.schema.js";
import { relayChainOf } from "../relay-chains.js";

/** Relay's page for a request, or for a deposit's transaction before Relay named its request. */
function statusUrlOf(id: string): string {
  return `https://relay.link/transaction/${id}`;
}

/** Relay's page for a deposit by its transaction, worked out without asking Relay. */
export function depositPageOf(deposit: DepositRef): string {
  return statusUrlOf(deposit.hash);
}

function badAnswer(): BinferenceError {
  return new BinferenceError({
    code: "relay.unavailable",
    message: "Relay's requests name another deposit, or a chain the bridge does not serve.",
    retryable: true,
  });
}

// The deposit on an EVM chain is named by its 32-byte transaction hash.
function depositHashOf(deposit: DepositRef): Hex {
  const { hash } = deposit;
  if (!isHex(hash) || hash.length !== 66) {
    throw new BinferenceError({
      code: "relay.not_evm",
      message: "Relay's deposits on this chain are EVM transactions, named by a 32-byte hash.",
    });
  }
  return hash;
}

// A transaction Relay names, on its own chain, as a deposit reference: on the deposit's chain, or
// on a chain the bridge delivers to.
function refOf(tx: RelayTx, chains: readonly BridgeDestination[]): DepositRef | undefined {
  const chain = chains.find((item) => item.id === tx.chainId.toString())?.chain;
  return chain !== undefined && isTxHash(tx.hash) ? { chain, hash: tx.hash } : undefined;
}

// Where the request stands by Relay's word: a fill or a refund names the transaction that paid
// out, which only a read of its chain settles. A success reads its first transaction on a
// destination, a refund its first on the source chain, each else the other: a refund paid on the
// destination chain pays the recipient there, so it reads as a fill. Relay may name more than one
// transaction, such as one that tops up gas; a failure no refund will follow is past its fill.
function paidOutOf(
  request: RelayRequest,
  deposit: DepositRef,
  destinations: readonly BridgeDestination[],
): DepositRef {
  const source = relayChainOf(deposit.chain);
  const chains = source === undefined ? destinations : [...destinations, source];
  const paidOut = request.outTxs.flatMap((tx) => refOf(tx, chains) ?? []);
  const toDestination = paidOut.find((ref) => ref.chain !== deposit.chain);
  const toSource = paidOut.find((ref) => ref.chain === deposit.chain);
  const out =
    request.status === "success" ? (toDestination ?? toSource) : (toSource ?? toDestination);
  if (out === undefined || paidOut.length !== request.outTxs.length) {
    throw badAnswer();
  }
  return out;
}

function stateOf(
  request: RelayRequest,
  deposit: DepositRef,
  destinations: readonly BridgeDestination[],
): DepositState {
  if (request.status === "success" || request.status === "refund") {
    const out = paidOutOf(request, deposit, destinations);
    return out.chain === deposit.chain
      ? { kind: "refunded", refund: out }
      : { kind: "filled", fill: out };
  }
  if (request.status === "failure" && request.refundFailReason !== undefined) {
    return { kind: "expired" };
  }
  return { kind: "pending" };
}

/**
 * Where a Relay deposit stands by Relay's word, read by its transaction: `unseen` until Relay's
 * indexer saw it, then pending, filled with the fill's transaction on the destination chain,
 * refunded with the refund's transaction on the source chain, or expired once a failed fill gets
 * no refund from Relay, which the owner takes up on Relay's page. An answer about another deposit
 * or naming a chain the bridge does not serve throws `relay.unavailable`.
 */
export async function depositStatus(
  deposit: DepositRef,
  parts: { readonly api: RelayApi; readonly destinations: readonly BridgeDestination[] },
  signal: AbortSignal,
): Promise<DepositStatus> {
  signal.throwIfAborted();
  const hash = depositHashOf(deposit);
  const requests = await parts.api.requests(hash, signal);
  const source = relayChainOf(deposit.chain);
  const own = requests.filter((request) =>
    request.inTxs.some(
      (tx) => tx.hash.toLowerCase() === hash.toLowerCase() && tx.chainId.toString() === source?.id,
    ),
  );
  const [request] = own;
  if (requests.length > 0 && (own.length !== 1 || request === undefined)) {
    throw badAnswer();
  }
  if (request === undefined) {
    return { state: { kind: "unseen" }, statusUrl: statusUrlOf(hash) };
  }
  const state = stateOf(request, deposit, parts.destinations);
  return { state, statusUrl: statusUrlOf(request.id) };
}
