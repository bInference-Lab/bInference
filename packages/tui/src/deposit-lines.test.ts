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
      "Send only BNB Smart Chain assets to this address. An asset sent on another network can be lost.",
      "This agent trades on paper: what you send here is real money, and it waits in this wallet until you switch the agent to live.",
    ]);
  });
});
