import { createSecret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { cleartextFinding } from "./cleartext-finding.js";

function configWith(urls: readonly string[]) {
  return configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
    network: { proxy: { fromEnv: "TEST_PROXY" }, noProxy: ["rpc.corp.test"] },
    chains: { rpc: { "eip155:56": { urls } } },
  });
}

describe("cleartextFinding", () => {
  it("is skipped without a proxy URL", () => {
    expect(cleartextFinding(undefined)).toStrictEqual({
      check: "network.cleartext",
      level: "skip",
    });
  });

  it("is fine with https RPCs and a proxy on this machine", () => {
    const config = configWith([
      "https://rpc.example.org/",
      "http://rpc.corp.test/",
      "http://10.0.0.5:8545/",
    ]);
    const proxy = createSecret("http://owner:pass@127.0.0.1:7890");
    expect(cleartextFinding({ config, proxy })).toStrictEqual({
      check: "network.cleartext",
      level: "ok",
    });
  });

  it("warns of http RPCs the proxy carries and a password sent in the clear, naming neither", () => {
    const config = configWith(["http://rpc.example.org/", "http://rpc2.example.org/"]);
    const proxy = createSecret("http://owner:pass@proxy.owner.test:3128");
    const finding = cleartextFinding({ config, proxy });
    expect(finding).toMatchObject({
      check: "network.cleartext",
      level: "warn",
      message: { key: "check.proxy.cleartextRpc", values: { count: 2 } },
      more: [{ key: "check.proxy.cleartextPassword", values: {} }],
      details: { rpcs: 2, password: true },
    });
    expect(JSON.stringify(finding)).not.toContain("proxy.owner.test");
  });
});
