import type { ChainDefinition } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { checkDefinition } from "./definition-checks.js";
import { isChecksummed } from "./evm-checksum.js";

/**
 * Checks an EVM chain bridges deliver to: its entries, read only with no relay, ETH as its coin,
 * Multicall3 for balance reads, and each RPC a keyless https endpoint apart from the others.
 * Test support.
 */
export function checkEvmDestination(definition: ChainDefinition, chainId: string): void {
  checkDefinition(definition, isChecksummed);

  describe(`${definition.key} as a bridge destination`, () => {
    it("is an eip155 chain with its EIP-155 chain id and ETH as its coin", () => {
      expect(definition.id).toBe(`eip155:${chainId}`);
      expect(definition.family).toBe("evm");
      expect(definition.nativeAsset).toMatchObject({ assetReference: "60", decimals: 18 });
    });

    it("sends nothing: it has no relay", () => {
      expect(definition.relays).toStrictEqual([]);
    });

    it("lists Multicall3, which reads a balance", () => {
      expect(definition.contracts.map(({ venue, name }) => `${venue}/${name}`)).toContain(
        "multicall3/multicall3",
      );
    });

    it("fails over across at least two keyless RPCs", () => {
      const urls = definition.rpcs.map(({ url }) => url);
      expect(new Set(urls).size).toBeGreaterThanOrEqual(2);
      expect(urls.every((url) => !/key|token/i.test(url))).toBe(true);
    });
  });
}
