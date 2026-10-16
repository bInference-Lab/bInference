import { describe, expect, it } from "vitest";
import { configTree } from "../config-json-schema.js";
import { envSegment, readEnvLayer } from "./env-layer.js";

describe("env layer", () => {
  it("writes a key's segment in capitals with underscores between words", () => {
    expect(
      ["port", "webhookPort", "shutdownBudgetMs", "inputPerMTokUsd"].map(envSegment),
    ).toStrictEqual(["PORT", "WEBHOOK_PORT", "SHUTDOWN_BUDGET_MS", "INPUT_PER_MTOK_USD"]);
  });

  it("reads each variable as text, a number or JSON by what its key takes", () => {
    const layer = readEnvLayer(configTree, {
      BINFERENCE_ENGINE__PORT: "7460",
      BINFERENCE_TELEGRAM__MODE: "webhook",
      BINFERENCE_CHATS__KEEP_DAYS: "forever",
      BINFERENCE_MODELS__PROVIDERS__ROUTER__BASE_URL: "https://router.example/v1",
      BINFERENCE_NETWORK__NO_PROXY: '["localhost"]',
      BINFERENCE_HOME: "binference-state",
      BINFERENCE_MCP_TOKEN: `bnt_${"s".repeat(43)}`,
      BINFERENCE_INIT_RESCUE: "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB",
      BINFERENCE_INIT_ANSWERS: "/srv/binference/answers.json5",
      PATH: "/usr/bin",
    });
    expect(layer.issues).toStrictEqual([]);
    expect(layer.entries.map((entry) => [entry.path.join("."), entry.value])).toStrictEqual([
      ["chats.keepDays", "forever"],
      ["engine.port", 7460],
      ["models.providers.router.baseUrl", "https://router.example/v1"],
      ["network.noProxy", ["localhost"]],
      ["telegram.mode", "webhook"],
    ]);
  });

  it("names a variable that goes below a value", () => {
    const layer = readEnvLayer(configTree, { BINFERENCE_ENGINE__PORT__NUMBER: "1" });
    expect(layer.issues).toMatchObject([
      { path: "engine.port.number", problem: { kind: "unknown_key" } },
    ]);
  });
});
