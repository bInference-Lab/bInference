import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { hasPolledChain, rpcPushedOf } from "./rpc-pushed-finding.js";

const base = { version: currentConfigVersion, telegram: { botToken: { fromEnv: "BOT" } } };
const polled = configSchema.parse(base);
const ownUrl = configSchema.parse({
  ...base,
  chains: { rpc: { "eip155:56": { urls: ["https://bsc.example"] } } },
});
const pushed = configSchema.parse({
  ...base,
  chains: { rpc: { "eip155:56": { ws: { fromEnv: "BSC_WS" } } } },
});

describe("the pushed blocks check", () => {
  it("warns while live orders wait on blocks polled over HTTP, an RPC's URL or not", () => {
    const warning = {
      check: "rpc.pushed",
      level: "warn",
      message: { key: "check.rpcPushed", values: { count: 2 } },
      details: { chains: ["eip155:56"], orders: 2 },
    };
    expect(rpcPushedOf(polled, 2)).toStrictEqual(warning);
    expect(rpcPushedOf(ownUrl, 2)).toStrictEqual(warning);
  });

  it("passes with no live order, or with a wss URL on every enabled chain", () => {
    expect(rpcPushedOf(polled, 0)).toStrictEqual({ check: "rpc.pushed", level: "ok" });
    expect(rpcPushedOf(pushed, 2)).toStrictEqual({ check: "rpc.pushed", level: "ok" });
    expect([
      hasPolledChain(polled),
      hasPolledChain(pushed),
      hasPolledChain(undefined),
    ]).toStrictEqual([true, false, false]);
  });

  it("is skipped without config or an engine to count the orders", () => {
    expect(rpcPushedOf(undefined, 2)).toStrictEqual({ check: "rpc.pushed", level: "skip" });
    expect(rpcPushedOf(polled, undefined)).toStrictEqual({ check: "rpc.pushed", level: "skip" });
  });
});
