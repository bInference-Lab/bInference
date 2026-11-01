import { accountRefSchema, recipientHexBytes } from "@binference/chain";
import { createEvmAddressCodec } from "@binference/chain-evm";
import { createSolanaAddressCodec } from "@binference/chain-solana";
import { bsc } from "@binference/chains";
import { buildCeiling, type PolicyRule } from "@binference/custody-privy";
import { solanaBridgeId, testBridgeCeilingRequest } from "@binference/custody-privy/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ceilingAddressesOf } from "./ceiling-addresses.js";
import { selfHostedCeilingAddresses } from "./self-hosted-destinations.js";

const solanaChain = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const solana = createSolanaAddressCodec();
const evm = createEvmAddressCodec();
// Solana gets the id a bridge gives it, as a venue that declares a deposit there would.
const base = selfHostedCeilingAddresses([bsc]);
const parts = {
  ...base,
  chainIdsOf: (chain: string) =>
    chain === solanaChain ? [solanaBridgeId] : base.chainIdsOf(chain as never),
};

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) {
    throw new Error("Expected a value.");
  }
  return result.value;
}

// The recipients a built ceiling's bridge rule to a destination lists.
function listedFor(rules: readonly PolicyRule[], destination: string): readonly string[] {
  const rule = rules.find((item) => item.name.includes(` to ${destination}, 1`));
  const recipient = rule?.conditions.find((item) => item.field.endsWith(".recipient"));
  return [recipient?.value ?? []].flat();
}

function rulesFor(accounts: readonly string[]): readonly PolicyRule[] {
  const saved = ceilingAddressesOf(
    accounts.map((account) => accountRefSchema.parse(account)),
    parts,
  );
  return unwrap(buildCeiling({ ...testBridgeCeilingRequest(), saved, bridged: saved })).rules;
}

const bytesOf = (length: number) => fc.uint8Array({ minLength: length, maxLength: length });

describe("the recipient bytes a ceiling holds", () => {
  it("decode back to the saved base58 address on Solana, and the checksummed address on Base", () => {
    fc.assert(
      fc.property(bytesOf(32), bytesOf(20), (thirtyTwo, twenty) => {
        const solanaAddress = unwrap(solana.fromBytes(thirtyTwo));
        const evmAddress = unwrap(evm.fromBytes(twenty));
        const rules = rulesFor([`${solanaChain}:${solanaAddress}`, `eip155:8453:${evmAddress}`]);
        const [held32 = ""] = listedFor(rules, solanaBridgeId);
        const [held20 = ""] = listedFor(rules, "8453");
        expect(unwrap(solana.fromBytes(unwrap(recipientHexBytes(held32))))).toBe(solanaAddress);
        expect(held20).toBe(evmAddress);
        expect(unwrap(evm.fromBytes(unwrap(evm.toBytes(held20))))).toBe(evmAddress);
      }),
      { numRuns: 300 },
    );
  });
});
