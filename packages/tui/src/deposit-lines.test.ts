import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { depositLines } from "./deposit-lines.js";

const formatter = createFormatter({ locale: "en", timeZone: "UTC" });
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";
const main = {
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000010",
  agent,
  address: "eip155:56:0x52908400098527886E0F7030069857D2E4169EE7",
  label: "Main",
  chainName: "BNB Smart Chain",
  createdAt: 1,
};

describe("the deposit lines in the terminal, while the breaker holds", () => {
  it("name the breaker's hold in the place of a freeze", () => {
    const lines = depositLines(formatter, {
      kind: "chat/deposit",
      agent,
      turn: "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
      mode: "live",
      frozen: true,
      breaker: true,
      wallets: [main] as never,
    });
    expect(lines.map(({ text }) => text).at(-1)).toBe(
      "Held by bInference's breaker: deposits arrive and stay in this wallet, but the agent trades nothing until bInference lifts it.",
    );
  });
});

describe("the deposit lines in the terminal", () => {
  it("print each wallet's address as the engine read it, the network, and a paper agent's warning", () => {
    const lines = depositLines(formatter, {
      kind: "chat/deposit",
      agent,
      turn: "trn_0190f1c2-3a4b-7c5d-8e6f-0123456789ab",
      mode: "paper",
      frozen: false,
      wallets: [main] as never,
    });
    expect(lines.map(({ text }) => text)).toStrictEqual([
      "Main · BNB Smart Chain",
      "  0x52908400098527886E0F7030069857D2E4169EE7",
      "Send only BNB Smart Chain assets here. Assets sent on any other network can be lost.",
      `${String.fromCodePoint(0x1f9ea)} Paper mode: deposits are real money and stay in this wallet until you switch the agent to live.`,
    ]);
  });
});
