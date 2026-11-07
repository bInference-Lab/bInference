import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf, toolTurn, wallet } from "../testing/agent-tool-fixtures.js";

const shown = {
  wallets: [
    {
      wallet,
      agent,
      address: "eip155:56:0x52908400098527886E0F7030069857D2E4169EE7",
      label: "Main",
      chainName: "BNB Smart Chain",
      createdAt: 1,
    },
    {
      wallet,
      agent,
      address: "eip155:56:0x0000000000000000000000000000000000000b0b",
      label: "Launch",
      role: "launch",
      createdAt: 2,
    },
  ],
};

describe("the deposit_address tool", () => {
  it("has the engine show the owner the wallets in this turn's chat, and answers their addresses", async () => {
    const run = callTool({ "turn/deposit": shown }, { name: "deposit_address", args: {} });
    const outcome = await outcomeOf(run);
    expect(run.client.calls()).toStrictEqual([
      { op: "turn/deposit", args: { agent, turn: toolTurn.turn } },
    ]);
    expect(outcome.text.split("\n")).toStrictEqual([
      "The owner now sees each of these wallets in this chat, with its address and its QR code:",
      "Main (agent wallet, BNB Smart Chain): 0x52908400098527886E0F7030069857D2E4169EE7",
      "Launch (launch wallet, eip155:56): 0x0000000000000000000000000000000000000b0b",
    ]);
    expect(outcome.isError).toBe(false);
  });

  it("takes no wallet or address from the model", () => {
    const run = callTool({}, { name: "deposit_address", args: { address: "0xbad" } });
    expect(run.refused).toMatch(/^not run: the arguments do not match/);
  });

  it("tells the model when the agent has no wallet to fund", async () => {
    const none = new BinferenceError({ code: "wallet.not_found", message: "No wallet." });
    const outcome = await outcomeOf(
      callTool({ "turn/deposit": none }, { name: "deposit_address", args: {} }),
    );
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toContain("binference wallet create");
  });
});
