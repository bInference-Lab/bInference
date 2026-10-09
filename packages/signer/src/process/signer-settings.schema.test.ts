import { describe, expect, it } from "vitest";
import { signerNodeArguments } from "./signer-node-arguments.js";
import { readSignerSettings } from "./signer-settings.schema.js";

const read = (settings: object): unknown => readSignerSettings(JSON.stringify(settings));
const caps = [{ chain: "eip155:56", feePerGasBase: "1000000000" }];
const decodedCaps = [{ chain: "eip155:56", feePerGasBase: 1_000_000_000n }];

describe("signer settings", () => {
  it.each([
    ["Privy's API", { chains: ["eip155:56"], privyApi: "https://api.privy.io" }],
    ["two chains", { chains: ["eip155:56", "eip155:1"], privyApi: "https://api.privy.io" }],
    ["a Privy stand-in on loopback", { chains: ["eip155:56"], privyApi: "http://127.0.0.1:8545" }],
  ])("reads settings with %s and each chain's fee cap", (_case, settings) => {
    const decoded = { ...settings, networkFeeCaps: decodedCaps };
    expect(read({ ...settings, networkFeeCaps: caps })).toStrictEqual(decoded);
  });

  it.each([
    ["no chain", { chains: [], privyApi: "https://api.privy.io" }],
    ["a malformed chain", { chains: ["bsc"], privyApi: "https://api.privy.io" }],
    ["plain http to another machine", { chains: ["eip155:56"], privyApi: "http://api.privy.io" }],
    ["a path after the origin", { chains: ["eip155:56"], privyApi: "https://api.privy.io/v1" }],
    ["a trailing slash", { chains: ["eip155:56"], privyApi: "https://api.privy.io/" }],
    ["no URL", { chains: ["eip155:56"], privyApi: "api.privy.io" }],
    ["an extra key", { chains: ["eip155:56"], privyApi: "https://api.privy.io", key: "x" }],
    [
      "a fee cap that is no decimal string",
      {
        chains: ["eip155:56"],
        privyApi: "https://api.privy.io",
        networkFeeCaps: [{ chain: "eip155:56", feePerGasBase: 1 }],
      },
    ],
  ])("refuses settings with %s", (_case, settings) => {
    expect(read({ networkFeeCaps: caps, ...settings })).toBeUndefined();
  });

  it("refuses settings without fee caps", () => {
    expect(read({ chains: ["eip155:56"], privyApi: "https://api.privy.io" })).toBeUndefined();
  });

  it("refuses a line that is not JSON", () => {
    expect(readSignerSettings("chains=eip155:56")).toBeUndefined();
  });

  it("starts the entry under the permission model with no grant and code from strings off", () => {
    expect(signerNodeArguments("/opt/binference/signer-process.mjs")).toStrictEqual([
      "--permission",
      "--disallow-code-generation-from-strings",
      "/opt/binference/signer-process.mjs",
    ]);
  });
});
