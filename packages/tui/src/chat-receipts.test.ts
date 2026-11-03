import type { CardLineView } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  bridgeIntent,
  bridgeReceipts,
  bridgeView,
  receiptView,
  depositHash,
  filledReceipt,
  solanaRecipient,
} from "./testing/bridge-receipt-views.js";
import { type ChatHarness, startChat } from "./testing/chat-harness.js";

const ctrlC = "\u0003";
const done = String.fromCodePoint(0x2705);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const otherAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000002";
const chats: ChatHarness[] = [];

afterEach(async () => {
  for (const chat of chats.splice(0)) {
    chat.press(ctrlC);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each chat ends before the next test
    await chat.ended;
  }
});

// An English chat whose engine answers the bridge's view with `line`, after `moves` pushes of the
// bridge moving into `state`: answers the rows above the prompt.
async function printedAfter(
  line: CardLineView,
  options: {
    readonly state: string;
    readonly moves: number;
    readonly agent?: string;
    readonly kind?: string;
  },
): Promise<readonly string[]> {
  const view =
    options.kind === undefined ? bridgeView(line, options.agent) : receiptView(line, options.kind);
  const chat = startChat({ "intent/get": () => view });
  chats.push(chat);
  await chat.settle();
  const before = chat.rows().length;
  for (let move = 0; move < options.moves; move += 1) {
    chat.push("intent", "intent/changed", { intent: bridgeIntent, state: options.state });
    // oxlint-disable-next-line eslint/no-await-in-loop -- each push prints before the next
    await chat.settle();
  }
  return chat.rows().slice(before - 1, -1);
}

describe("a bridge's receipts in terminal chat, in English", () => {
  it.each([
    {
      name: "on its way once its deposit is final",
      line: bridgeReceipts.sent,
      state: "finalized",
      text: `${done} Left BNB Smart Chain · arrives on Solana in about 2 min · https://bscscan.com/tx/${depositHash}`,
    },
    {
      name: "delivered once a read found the payment",
      line: bridgeReceipts.delivered,
      state: "reconciled",
      text: `${done} Delivered on Solana: Cold wallet (${solanaRecipient}) received 19.95 USDC · https://solscan.io/tx/5VERv8NMvzbJMEkV8xnrLkEaWRtSz9Cos`,
    },
    {
      name: "paid back, with the refund's hash",
      line: bridgeReceipts.refunded,
      state: "reconciled",
      text: `${warning} Not delivered: Relay paid 20 USDT back to Bridge · transaction 0xcdcd…cdcd`,
    },
  ])("prints the receipt $name, once for two pushes", async ({ line, state, text }) => {
    expect(await printedAfter(line, { state, moves: 2 })).toStrictEqual([text]);
  });

  it("prints nothing for another agent's bridge, or a move that says nothing new", async () => {
    const other = { state: "reconciled", moves: 1, agent: otherAgent };
    expect(await printedAfter(bridgeReceipts.delivered, other)).toStrictEqual([]);
    const sending = { state: "executing", moves: 1 };
    expect(await printedAfter(bridgeReceipts.sent, sending)).toStrictEqual([]);
  });
});

describe("any other intent's receipts in terminal chat, in English", () => {
  it("prints a trade's receipt with its link once it ends on chain", async () => {
    const ended = { state: "reconciled", moves: 2, kind: "swap" };
    expect(await printedAfter(filledReceipt, ended)).toStrictEqual([
      `${done} Done: 20 USDT → 19.95 USDC · https://bscscan.com/tx/${depositHash}`,
    ]);
  });

  it("prints nothing for the sending line, or a card that took effect as it was answered", async () => {
    const sending: CardLineView = { key: "receipt.confirmed", values: {} };
    expect(
      await printedAfter(sending, { state: "finalized", moves: 1, kind: "swap" }),
    ).toStrictEqual([]);
    const unfrozen: CardLineView = {
      key: "receipt.unfrozenAgent",
      values: { agent: { type: "text", text: "main" } },
    };
    expect(
      await printedAfter(unfrozen, { state: "reconciled", moves: 1, kind: "unfreeze" }),
    ).toStrictEqual([]);
  });
});
