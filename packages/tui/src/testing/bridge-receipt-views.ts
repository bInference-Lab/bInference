import type { CardLineView, CardValueView } from "@binference/protocol";
import { answerAsResult } from "./answer-as-result.schema.js";
import { harnessAgent } from "./chat-harness.js";

/** The bridge the receipt tests follow. */
export const bridgeIntent = "int_0190f1c2-3a4b-7c5d-8e6f-00000000000b";
/** A base58 address on Solana, as a bridge's recipient shows it whole. */
export const solanaRecipient = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
/** The deposit's transaction hash. */
export const depositHash: string = `0x${"cd".repeat(32)}`;

const usdt = "fake:1/token:0x0000000a";
const usdc = "fake:2/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const text = (value: string): CardValueView => ({ type: "text", text: value });
const amount = (asset: string, base: bigint): CardValueView =>
  answerAsResult({ type: "amount", amount: { asset, base } });

/** The line a bridge's card ends with at each move, as `intent/get` gives it. */
export const bridgeReceipts: {
  readonly sent: CardLineView;
  readonly delivered: CardLineView;
  readonly refunded: CardLineView;
} = {
  sent: {
    key: "receipt.bridgeSent",
    values: {
      fromChain: text("BNB Smart Chain"),
      chain: text("Solana"),
      minutes: { type: "count", count: 2 },
      explorerLink: text(`https://bscscan.com/tx/${depositHash}`),
    },
  },
  delivered: {
    key: "receipt.bridgeDelivered",
    values: {
      chain: text("Solana"),
      recipient: {
        type: "line",
        line: {
          key: "card.value.payee",
          values: { label: text("Cold wallet"), address: text(solanaRecipient) },
        },
      },
      received: amount(usdc, 19_950_000n),
      explorerLink: text("https://solscan.io/tx/5VERv8NMvzbJMEkV8xnrLkEaWRtSz9Cos"),
    },
  },
  refunded: {
    key: "receipt.bridgeRefunded",
    values: {
      venue: text("Relay"),
      amount: amount(usdt, 20n * 10n ** 18n),
      wallet: text("Bridge"),
      explorerLink: {
        type: "line",
        line: { key: "receipt.tx", values: { txHash: text(depositHash) } },
      },
    },
  },
};

/** The bridge's view with its receipt line, for the agent the harness chats with or another. */
export function bridgeView(line: CardLineView, agent: string = harnessAgent): object {
  return {
    intent: bridgeIntent,
    agent,
    kind: "bridge",
    state: line.key === "receipt.bridgeSent" ? "finalized" : "reconciled",
    paper: false,
    assets: {
      [usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
      [usdc]: { symbol: "USDC", name: "USD Coin", decimals: 6, verified: true },
    },
    bridgeReceipt: line,
  };
}
