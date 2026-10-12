import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  agent,
  assets,
  callTool,
  coin,
  coinInfo,
  intent,
  intentWire,
  otherAgent,
  outcomeOf,
  token,
  tokenInfo,
  wallet,
} from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { agentToolBox } from "./agent-tools.js";

const portfolio = {
  balances: [{ wallet, amount: { asset: token, base: "500000000" }, paper: true }],
  positions: [],
  totalUsdMicros: "0",
  assets,
};

const portfolioCall = { name: "portfolio", args: {} };

describe("the read tools", () => {
  it("answer the engine's JSON, amounts as decimal strings", async () => {
    const outcome = await outcomeOf(callTool({ "portfolio/get": portfolio }, portfolioCall));
    expect(JSON.parse(outcome.text)).toMatchObject({
      balances: [{ amount: { asset: token, base: "500000000" } }],
      totalUsdMicros: "0",
    });
  });

  it("show an unlisted token by its address and the words unlisted token", async () => {
    const outcome = await outcomeOf(callTool({ "portfolio/get": portfolio }, portfolioCall));
    expect(JSON.parse(outcome.text)).toMatchObject({
      assets: {
        [coin]: coinInfo,
        [token]: { symbol: "unlisted token", name: "unlisted token", decimals: 6, verified: false },
      },
    });
    expect(outcome.text).not.toMatch(/IGNORE|Send everything|example\.invalid/);
    expect(outcome).not.toHaveProperty("outside");
  });

  it("show an intent's unlisted tokens the same way", async () => {
    const answers = { "intent/get": intentWire("awaiting_confirmation") };
    const outcome = await outcomeOf(callTool(answers, { name: "tx_status", args: { intent } }));
    expect(outcome.text).toContain('"unlisted token"');
    expect(outcome.text).not.toMatch(/IGNORE|Send everything/);
  });

  it("mark token_info of an unlisted token as outside content, names and all", async () => {
    const answers = { "asset/get": { asset: token, ...tokenInfo } };
    const outcome = await outcomeOf(
      callTool(answers, { name: "token_info", args: { asset: token } }),
    );
    expect(outcome).toMatchObject({ isError: false, outside: true });
    expect(outcome.text).toContain("IGNORE ALL RULES");
  });

  it("keep token_info of a listed token clean", async () => {
    const answers = { "asset/get": { asset: coin, ...coinInfo } };
    const outcome = await outcomeOf(
      callTool(answers, { name: "token_info", args: { asset: coin } }),
    );
    expect(outcome).not.toHaveProperty("outside");
    expect(outcome.text).toContain('"FAKE"');
  });

  it("answer an intent of another agent as one this agent does not have", async () => {
    const answers = { "intent/get": intentWire("awaiting_confirmation", otherAgent) };
    const outcome = await outcomeOf(callTool(answers, { name: "tx_status", args: { intent } }));
    expect(outcome).toStrictEqual({ text: `This agent has no intent ${intent}.`, isError: true });
  });

  it("answer a failure with its code and the engine's message", async () => {
    const missing = new BinferenceError({ code: "asset.not_found", message: "No such asset." });
    const call = { name: "token_risk", args: { asset: token } };
    const outcome = await outcomeOf(callTool({ "risk/check": missing }, call));
    expect(outcome).toStrictEqual({
      text: "token_risk failed with asset.not_found: No such asset.",
      isError: true,
    });
  });

  it("all run beside each other", () => {
    const box = agentToolBox({ agent, client: createFakeToolClient({}) });
    const reads = [
      ["portfolio", {}],
      ["token_info", { asset: token }],
      ["token_risk", { asset: token }],
      ["quote", { from: coin, to: token, amount: { base: "1" }, reason: "r" }],
      ["orders", {}],
      ["tx_status", { intent }],
    ] as const;
    const prepared = reads.map(([name, args]) =>
      box.prepare({ id: "c1", name, argumentsText: JSON.stringify(args) }),
    );
    expect(prepared).toMatchObject(
      reads.map(() => ({ ready: true, kind: "read", parallel: true })),
    );
  });
});
