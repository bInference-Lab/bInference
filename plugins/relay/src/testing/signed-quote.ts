import { BinferenceError } from "@binference/plugin-sdk";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readQuoteAnswer } from "../api/quote-answer.schema.js";
import { orderIdOf } from "../order/order-id.js";
import { relaySolver } from "../relay-chains.js";
import usdcToBase from "./recorded/quote-usdc-base.json" with { type: "json" };

/** Who a test's quote is made out for, and the key that signs its order. */
export interface SignedQuoteAsk {
  /** The wallet that deposits and takes a refund on BSC. */
  readonly depositor: Address;
  /** Who the fill pays on Base. */
  readonly recipient: Address;
  /** The key a test's bridge takes as Relay's solver. */
  readonly solverKey: Hex;
  /** Until when the order and its refunds hold, Unix seconds. */
  readonly deadline: number;
}

/** What the recorded quote pays: 20 BSC USDC in, this much Base USDC out, in base units. */
export const signedQuoteOutput = 19_899_080n;

const recordedText = JSON.stringify(usdcToBase);
const recordedDeadline = "1794151754";
const recordedSolver = relaySolver;
const recorded = readQuoteAnswer(recordedText);

// An address's 40 hex digits as the recorded answer writes them.
const lower = (address: string): string => address.slice(2).toLowerCase();

/**
 * Relay's recorded quote of 20 BSC USDC to Base USDC made out for another depositor, recipient and
 * deadline, its order named by the solver of `solverKey`, its id worked out again and signed by
 * that key, and its deposit naming the new id: an answer a bridge whose solver is that key takes,
 * and Relay's own bridge refuses.
 */
export async function signedQuoteFor(ask: SignedQuoteAsk): Promise<string> {
  const solver = privateKeyToAccount(ask.solverKey);
  const made = recordedText
    .replaceAll("1".repeat(40), lower(ask.depositor))
    .replaceAll("2".repeat(40), lower(ask.recipient))
    .replaceAll(lower(recordedSolver), lower(solver.address))
    .replaceAll(recordedDeadline, String(ask.deadline));
  const order = readQuoteAnswer(made)?.order;
  const orderId = order === undefined ? undefined : orderIdOf(order);
  if (recorded === undefined || orderId === undefined) {
    throw new BinferenceError({ code: "relay.bad_fixture", message: "The recorded quote reads." });
  }
  const signature = await solver.signMessage({ message: { raw: orderId } });
  return made
    .replaceAll(recorded.orderId.slice(2), orderId.slice(2))
    .replace(recorded.orderSignature ?? "", signature);
}
