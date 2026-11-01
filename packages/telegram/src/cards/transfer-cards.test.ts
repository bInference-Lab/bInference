import { messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { showTransferCard, type TransferPress } from "../testing/transfer-card-bench.js";
import {
  base58Recipient,
  baseBridgeFacts,
  checksummedRecipient,
  nameSendFacts,
  rescueSendFacts,
  revokeFacts,
  savedSendFacts,
  solanaBridgeFacts,
} from "../testing/transfer-card-fixtures.js";

const waiting = String.fromCodePoint(0x1f7e1);
const live = String.fromCodePoint(0x1f534);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const header = (kind: string) => `${waiting} Confirm ${kind} · main · ${live} Live`;
const expiry = "Expires at 14:32:05";

// Telegram's most characters in the answer to a press (Bot API `answerCallbackQuery`).
const maxAnswerLength = 200;

describe("send, revoke and bridge cards in the owner's chat, in English", () => {
  it("shows a bridge to a base58 address with every line a bridge has", async () => {
    const payee = `Cold wallet (${base58Recipient})`;
    expect((await showTransferCard("en", solanaBridgeFacts)).lines).toStrictEqual([
      header("bridge"),
      `Bridge 20 USDT to Solana · to ${payee} · about 2 min`,
      `${payee} receives at least 19.91 USDC on Solana`,
      "Bridge fees 0.06 USDT · through Relay",
      "Swap rate: 0.15%",
      "binference reads Solana to see it arrive, and tells you if it is late",
      "A Solana address has no checksum: check every character",
      "From your bridge wallet Bridge",
      `${warning} USDT arrives on Solana as USDC, a different token`,
      'Agent says  "Moving profits to my Solana wallet"',
      expiry,
    ]);
  });

  it("shows a bridge to the rescue address whole and checksummed, in the token it sends", async () => {
    const payee = `your rescue address (${checksummedRecipient})`;
    expect((await showTransferCard("en", baseBridgeFacts)).lines).toStrictEqual([
      header("bridge"),
      `Bridge 20 USDT to Base · to ${payee} · about 1 min`,
      `${payee} receives at least 19.97 USDT on Base`,
      "Bridge fees 0.03 USDT · through Across",
      "binference reads Base to see it arrive, and tells you if it is late",
      'Agent says  "Rescue the profits to Base"',
      expiry,
    ]);
  });

  it("shows a send by name with the address it points to, its read and its warnings", async () => {
    expect((await showTransferCard("en", nameSendFacts)).lines).toStrictEqual([
      header("send"),
      `Send 1 USDT to alice.bnb (${checksummedRecipient})`,
      `alice.bnb points to ${checksummedRecipient}, read at 14:31:05; binference reads it again before it signs`,
      "alice.bnb is a smart-account wallet",
      `${warning} You have never sent to this address`,
      `${warning} This address's reverse record names bob.bnb, not alice.bnb`,
      'Agent says  "Paying Alice as you asked"',
      expiry,
    ]);
  });

  it.each([
    ["a saved address by its label", savedSendFacts, `Savings (${checksummedRecipient})`],
    ["the rescue address", rescueSendFacts, `your rescue address (${checksummedRecipient})`],
  ])("shows a send to %s, its address whole", async (_name, facts, recipient) => {
    expect((await showTransferCard("en", facts)).lines.slice(0, 2)).toStrictEqual([
      header("send"),
      `Send 1 USDT to ${recipient}`,
    ]);
  });

  it("shows a revoke with its spender's registry name before its short address", async () => {
    expect((await showTransferCard("en", revokeFacts)).lines.slice(0, 2)).toStrictEqual([
      header("approval revoke"),
      "Remove PancakeSwap v2 router (0x71C7…976F)'s approval for USDT",
    ]);
  });

  it("answers a Confirm that closes a bridge card with no words, only ending the spinner", async () => {
    expect((await showTransferCard("en", solanaBridgeFacts, "confirmed")).answer).toBeUndefined();
  });

  it.each<[TransferPress, string]>([
    ["locked", "error.engine.locked"],
    ["over_cap", "error.limit.daily_cap"],
  ])(
    "answers a %s press of a bridge to a base58 address within 200 characters",
    async (press, key) => {
      const { answer } = await showTransferCard("en", solanaBridgeFacts, press);
      expect(answer).toBe(messages.en[key]);
      expect(String(answer).length).toBeLessThanOrEqual(maxAnswerLength);
    },
  );
});
