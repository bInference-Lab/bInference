import type { Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import { accountRefParts, parseAccountRef, printAccountRef } from "./account-ref.js";
import { assertChainRef } from "./assert-chain-ref.js";
import { assetRefParts, assetRefSchema, parseAssetRef, printAssetRef } from "./asset-ref.js";
import { chainRefParts, chainRefSchema, parseChainRef, printChainRef } from "./chain-ref.js";

// Gives the value of a success, so a test can chain on it without a conditional.
function unwrap<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

const usdt = "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955";
const wallet = "eip155:56:0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";

describe("chain ids", () => {
  it("parses and splits a chain id", () => {
    const parsed = parseChainRef("eip155:56");
    expect(parsed).toStrictEqual({ ok: true, value: "eip155:56" });
    expect(chainRefParts(chainRefSchema.parse("eip155:56"))).toStrictEqual({
      namespace: "eip155",
      reference: "56",
    });
  });

  it.each(["eip155", "e:56", "EIP155:56", "eip155:", "eip155:5 6", `eip155:${"1".repeat(33)}`])(
    "answers %j with an expected failure",
    (text) => {
      expect(parseChainRef(text)).toStrictEqual({ ok: false, error: "malformed_chain_ref" });
    },
  );

  it("refuses to print parts that would read as another id", () => {
    expect(printChainRef({ namespace: "eip155", reference: "56:1" })).toStrictEqual({
      ok: false,
      error: "malformed_chain_ref",
    });
  });
});

describe("account ids", () => {
  it("splits an account id into its chain and address", () => {
    expect(accountRefParts(unwrap(parseAccountRef(wallet)))).toStrictEqual({
      chain: "eip155:56",
      address: "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3",
    });
  });

  it.each(["eip155:56", "eip155:56:", "eip155:56:0x12 34", "eip155/56:0x1234"])(
    "answers %j with an expected failure",
    (text) => {
      expect(parseAccountRef(text)).toStrictEqual({ ok: false, error: "malformed_account_ref" });
    },
  );

  it("refuses to print an address that holds a separator", () => {
    const chain = chainRefSchema.parse("eip155:56");
    expect(printAccountRef({ chain, address: "0x12:34" }).ok).toBe(false);
  });
});

describe("asset types", () => {
  it("splits a token and the native coin", () => {
    expect(assetRefParts(assetRefSchema.parse(usdt))).toStrictEqual({
      chain: "eip155:56",
      assetNamespace: "erc20",
      assetReference: "0x55d398326f99059fF775485246999027B3197955",
    });
    const native = unwrap(parseAssetRef("eip155:56/slip44:714"));
    expect(assetRefParts(native).assetReference).toBe("714");
  });

  it.each(["eip155:56", "eip155:56/erc20", "eip155:56/er:0x1", "eip155:56/erc20:", "56/erc20:1"])(
    "answers %j with an expected failure",
    (text) => {
      expect(parseAssetRef(text)).toStrictEqual({ ok: false, error: "malformed_asset_ref" });
    },
  );

  it("refuses to print a reference that holds a slash", () => {
    const chain = chainRefSchema.parse("eip155:56");
    const parts = { chain, assetNamespace: "erc20", assetReference: "0x1/2" };
    expect(printAssetRef(parts).ok).toBe(false);
  });
});

describe("assertChainRef", () => {
  it("brands a well-formed chain part and throws on a broken one", () => {
    expect(assertChainRef("eip155:56")).toBe("eip155:56");
    expect(() => assertChainRef("broken")).toThrow(
      expect.objectContaining({ code: "chain.bad_chain_part" }),
    );
  });
});
