import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  agent,
  alert,
  alertWire,
  callTool,
  outcomeOf,
  priceCondition,
  token,
} from "../testing/agent-tool-fixtures.js";

const refusal = (code: `${string}.${string}`) =>
  new BinferenceError({ code, message: `The engine said ${code}.` });

describe("alert_create", () => {
  it("says what the alert watches, whether it wakes the agent, and when it ends", async () => {
    const answer = { ...alertWire(), wake: true, expiresAt: 1_792_458_000_000 };
    const outcome = await outcomeOf(
      callTool(
        { "alert/create": answer },
        { name: "alert_create", args: { condition: priceCondition } },
      ),
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain(
      `Alert ${alert} is active, on {"kind":"price","asset":"${token}"`,
    );
    expect(outcome.text).toContain("starts a turn of yours, marked as outside content");
    expect(outcome.text).toContain("It ends at 2026-10-20T01:00:00.000Z.");
  });

  it.each([
    ["alert.too_many", "already has 50 active alerts"],
    ["wallet.track_limit", "already watches 50 wallets"],
    ["market.no_data", "cannot price this token now"],
    ["protocol.bad_args", "the engine refused the terms"],
  ] as const)("reads %s as nothing stored and what to do next", async (code, words) => {
    const run = callTool(
      { "alert/create": refusal(code) },
      { name: "alert_create", args: { condition: priceCondition } },
    );
    const outcome = await outcomeOf(run);
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.text).toMatch(/^not set, and nothing was stored:/);
    expect(outcome.text).toContain(words);
  });

  it("reads any other refusal with the engine's code and message", async () => {
    const run = callTool(
      { "alert/create": refusal("agent.archived") },
      { name: "alert_create", args: { condition: priceCondition } },
    );
    await expect(outcomeOf(run)).resolves.toStrictEqual({
      text: "alert_create failed with agent.archived: The engine said agent.archived.",
      isError: true,
    });
  });

  it.each([
    ["an end with no offset", { condition: priceCondition, expiresAt: "2026-10-20T09:00:00" }],
    ["an end as a number", { condition: priceCondition, expiresAt: 1_792_458_000_000 }],
    ["a price as a number", { condition: { ...priceCondition, price: 1_500_000 } }],
    ["an agent", { condition: priceCondition, agent }],
  ])("refuses %s before the engine hears of it", (_case, args) => {
    const run = callTool({ "alert/create": alertWire() }, { name: "alert_create", args });
    expect(run.refused).toMatch(/^not run: the arguments do not match alert_create's schema/);
    expect(run.client.calls()).toStrictEqual([]);
  });
});
