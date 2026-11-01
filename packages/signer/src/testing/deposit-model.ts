import type { CallInputCheck } from "@binference/chain";
import * as fc from "fast-check";
import type { Data } from "./request-model.js";
import {
  bridgeDepositAbi,
  bridgeDepositCalldata,
  fixtureAddresses,
  fixtureDeposit,
} from "./sign-fixtures.js";

// Bridge deposits in the request model (decision 0302), written apart from the signer's reader:
// the deposit a request carries, the checks the engine passes for it, and what the oracle decides.

const { wallet, saved, stranger } = fixtureAddresses;

/** A bridge deposit the model carries. */
export interface DepositData {
  readonly kind: "deposit";
  readonly depositor: string;
  readonly recipient: string;
  readonly chain: bigint;
  readonly outputAmount: bigint;
  /** The message's bytes as hex, without `0x`. */
  readonly message: string;
}

/** What the engine passes for a deposit: its confirmed recipient and chain, and its least output. */
export interface DepositCheck {
  readonly recipient: string;
  readonly chain: bigint;
  readonly outputAmount: bigint;
}

/** The calldata of a modelled deposit. */
export function depositCalldata(data: DepositData): string {
  const { depositor, recipient, chain, outputAmount, message } = data;
  return bridgeDepositCalldata({
    ...fixtureDeposit,
    depositor,
    recipient,
    destinationChainId: chain,
    outputAmount,
    message,
  });
}

/** A modelled check as the signer's `allowed.callInputs` entry. */
export function depositCheckOf(check: DepositCheck): CallInputCheck {
  return {
    abi: bridgeDepositAbi,
    wallet: ["depositor"],
    equal: { recipient: check.recipient, destinationChainId: String(check.chain) },
    empty: ["message"],
    atLeast: { outputAmount: String(check.outputAmount) },
  };
}

/**
 * Rule 2's part, from the model alone: a checked deposit pays the checked recipient on the
 * checked chain, refunds the wallet and runs nothing on arrival. Anything else is unchecked.
 */
export function depositWhoOk(data: Data, check: DepositCheck | undefined): boolean {
  if (data.kind !== "deposit" || check === undefined) {
    return true;
  }
  return (
    data.depositor === wallet &&
    data.recipient === check.recipient &&
    data.chain === check.chain &&
    data.message === ""
  );
}

/** Rule 3's part: a checked deposit pays out at least the checked output. */
export function depositAmountOk(data: Data, check: DepositCheck | undefined): boolean {
  return data.kind !== "deposit" || check === undefined || data.outputAmount >= check.outputAmount;
}

/** Deposits from small pools, so kept and broken checks both come up often. */
export const deposits: fc.Arbitrary<DepositData> = fc.record({
  kind: fc.constant("deposit" as const),
  depositor: fc.constantFrom(wallet, wallet, stranger),
  recipient: fc.constantFrom(saved, saved, stranger),
  chain: fc.constantFrom(8453n, 8453n, 1n),
  outputAmount: fc.constantFrom(899n, 900n, 901n),
  message: fc.constantFrom("", "", "01"),
});

/** Checks from the same pools. */
export const depositChecks: fc.Arbitrary<DepositCheck> = fc.record({
  recipient: fc.constantFrom(saved, stranger),
  chain: fc.constantFrom(8453n, 1n),
  outputAmount: fc.constantFrom(900n, 901n),
});
