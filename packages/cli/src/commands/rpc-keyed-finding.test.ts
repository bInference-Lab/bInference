import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { rpcKeyedOf } from "./rpc-keyed-finding.js";

const base = { version: currentConfigVersion, telegram: { botToken: { fromEnv: "BOT" } } };
const publicOnly = configSchema.parse(base);
const ownWs = configSchema.parse({
  ...base,
  chains: { rpc: { "eip155:56": { ws: { fromEnv: "BSC_WS" } } } },
});
const ownUrl = configSchema.parse({
  ...base,
  chains: { rpc: { "eip155:56": { urls: ["https://bsc.example"] } } },
});

describe("the keyed RPC check", () => {
  it("warns while live orders watch prices over public RPCs only", () => {
    expect(rpcKeyedOf(publicOnly, 3)).toStrictEqual({
      check: "rpc.keyed",
      level: "warn",
      message: { key: "check.rpcKeyed", values: { count: 3 } },
      details: { chains: ["eip155:56"], orders: 3 },
    });
  });

  it("passes with no live order, or with an HTTP RPC of the owner's on every chain", () => {
    expect(rpcKeyedOf(publicOnly, 0)).toStrictEqual({ check: "rpc.keyed", level: "ok" });
    expect(rpcKeyedOf(ownUrl, 3)).toStrictEqual({ check: "rpc.keyed", level: "ok" });
  });

  it("still warns with only a WebSocket RPC of the owner's, since batches read the public nodes", () => {
    expect(rpcKeyedOf(ownWs, 3)).toMatchObject({ check: "rpc.keyed", level: "warn" });
  });

  it("is skipped without config or an engine to count the orders", () => {
    expect(rpcKeyedOf(undefined, 3)).toStrictEqual({ check: "rpc.keyed", level: "skip" });
    expect(rpcKeyedOf(publicOnly, undefined)).toStrictEqual({ check: "rpc.keyed", level: "skip" });
  });
});
