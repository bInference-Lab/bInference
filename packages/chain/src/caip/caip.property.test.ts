import type { Result } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { accountRefParts, parseAccountRef, printAccountRef } from "./account-ref.js";
import { assetRefParts, parseAssetRef, printAssetRef } from "./asset-ref.js";
import { chainRefParts, parseChainRef, printChainRef } from "./chain-ref.js";

// Gives the value of a success, so a test can chain on it without a conditional.
function unwrap<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

const namespace = fc.stringMatching(/^[-a-z0-9]{3,8}$/);
const reference = fc.stringMatching(/^[-_a-zA-Z0-9]{1,32}$/);
const address = fc.stringMatching(/^[-.%a-zA-Z0-9]{1,128}$/);
const chainParts = fc.record({ namespace, reference });

describe("caip id properties", () => {
  it("prints, parses and splits a chain id back to its parts", () => {
    fc.assert(
      fc.property(chainParts, (parts) => {
        const text = `${parts.namespace}:${parts.reference}`;
        expect(printChainRef(parts)).toStrictEqual({ ok: true, value: text });
        expect(parseChainRef(text)).toStrictEqual({ ok: true, value: text });
        expect(chainRefParts(unwrap(parseChainRef(text)))).toStrictEqual({ ...parts });
      }),
    );
  });

  it("prints, parses and splits an account id back to its parts", () => {
    fc.assert(
      fc.property(chainParts, address, (parts, account) => {
        const chain = `${parts.namespace}:${parts.reference}`;
        const text = `${chain}:${account}`;
        const parsed = parseAccountRef(text);
        expect(parsed).toStrictEqual({ ok: true, value: text });
        const split = accountRefParts(unwrap(parsed));
        expect(split).toStrictEqual({ chain, address: account });
        expect(printAccountRef(split)).toStrictEqual(parsed);
      }),
    );
  });

  it("prints, parses and splits an asset type back to its parts", () => {
    fc.assert(
      fc.property(chainParts, namespace, address, (parts, assetNamespace, assetReference) => {
        const chain = `${parts.namespace}:${parts.reference}`;
        const text = `${chain}/${assetNamespace}:${assetReference}`;
        const parsed = parseAssetRef(text);
        expect(parsed).toStrictEqual({ ok: true, value: text });
        const split = assetRefParts(unwrap(parsed));
        expect(split).toStrictEqual({ chain, assetNamespace, assetReference });
        expect(printAssetRef(split)).toStrictEqual(parsed);
      }),
    );
  });

  it("answers any text with a result and never throws", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (text) => {
        for (const parse of [parseChainRef, parseAccountRef, parseAssetRef]) {
          const result = parse(text);
          expect(typeof result.ok).toBe("boolean");
        }
      }),
    );
  });
});
