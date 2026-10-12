import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { firstAgentDraft } from "./first-agent.js";

const facts = {
  id: idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  atMs: 1_800_000_000_000,
  venues: [],
};
const usdt = "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955";

function draftWith(limits: Readonly<Record<string, readonly string[]>>) {
  const config = configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
    defaults: { limits },
  });
  return firstAgentDraft(config, selfHostedChains(), facts);
}

describe("the first agent's token lists", () => {
  it("keeps each token once, in its family's canonical form", () => {
    expect(draftWith({ denyTokens: [usdt.toLowerCase(), usdt] })).toMatchObject({
      ok: true,
      value: { limits: { denyTokens: [usdt] } },
    });
  });

  it.each([
    ["no CAIP-19 asset", "USDT"],
    [
      "a chain this binference does not serve",
      "eip155:1/erc20:0xdac17f958d2ee523a2206206994597c13d831ec7",
    ],
    [
      "an address with a wrong checksum",
      "eip155:56/erc20:0x55D398326f99059fF775485246999027B3197955",
    ],
  ])("stops init on %s", (_, token) => {
    expect(draftWith({ allowTokens: [token] })).toMatchObject({
      ok: false,
      refusal: { code: "init.bad_token", values: { token } },
    });
  });
});

// The first agent of a config with these defaults.
function draftOf(defaults: Readonly<Record<string, unknown>>) {
  const config = configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
    defaults,
  });
  return firstAgentDraft(config, selfHostedChains(), facts);
}

describe("the first agent's notices", () => {
  it("starts with every notice on and the daily summary at 09:00", () => {
    expect(draftOf({})).toMatchObject({
      ok: true,
      value: { notifications: { muted: [], dailySummaryTime: "09:00" } },
    });
  });

  it("starts with the muted kinds and the summary time the config's defaults name", () => {
    const notifications = { muted: ["lowGas", "update"], dailySummaryTime: "07:30" };
    expect(draftOf({ notifications })).toMatchObject({ ok: true, value: { notifications } });
  });

  it("refuses a config that mutes a security notice", () => {
    expect(() => draftOf({ notifications: { muted: ["frozen"] } })).toThrow(/"muted"/u);
  });
});
