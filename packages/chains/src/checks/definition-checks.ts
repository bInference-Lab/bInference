import { type ChainDefinition, chainDefinitionSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";

/**
 * Checks every chain file holds to: the definition parses, each token and contract address is in
 * its family's canonical form and appears once, and each carries a dated, sourced verification
 * record. `isCanonical` is the family's own form, such as the EIP-55 checksum. Test support.
 */
export function checkDefinition(
  definition: ChainDefinition,
  isCanonical: (address: string) => boolean,
): void {
  const entries = [
    ...definition.tokens.map((token) => ({ label: `token ${token.symbol}`, ...token })),
    ...definition.contracts.map((contract) => ({
      label: `${contract.venue}/${contract.name}`,
      ...contract,
    })),
  ];

  describe(`${definition.key} entries`, () => {
    it("passes the chain definition schema", () => {
      expect(chainDefinitionSchema.parse(definition)).toStrictEqual(definition);
    });

    it.each(entries)("spells $label in its family's canonical form", ({ address }) => {
      expect(isCanonical(address)).toBe(true);
    });

    it.each(entries)(
      "carries a dated, sourced verification record for $label",
      ({ verification }) => {
        expect(verification.source).toMatch(/^https:\/\/\S+$/);
        expect(verification.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(["read", "not_read"]).toContain(verification.control);
      },
    );

    it("keeps each address once across tokens and contracts", () => {
      const addresses = entries.map((entry) => entry.address);
      expect(new Set(addresses).size).toBe(addresses.length);
    });
  });
}
