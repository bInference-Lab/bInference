import { chainFamilyContract } from "@binference/chain/testing";
import * as fc from "fast-check";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { parseEvmAddress } from "./evm-address.js";
import { createEvmFamily } from "./evm-family.js";

const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

describe("evm family", () => {
  it.each(
    chainFamilyContract({
      create: () => ({
        family: createEvmFamily(),
        addresses: [
          { text: checksummed.toLowerCase(), canonical: checksummed },
          { text: `0x${checksummed.slice(2).toUpperCase()}`, canonical: checksummed },
          { text: checksummed, canonical: checksummed },
        ],
        malformed: [
          "",
          "0x",
          "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
          "0X5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
          "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beae",
          "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaedd",
          "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beazz",
          "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD",
        ],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("gives every 20-byte address one canonical form whatever its case", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 20, maxLength: 20 }), (bytes) => {
        const lower = `0x${Buffer.from(bytes).toString("hex")}`;
        const canonical = getAddress(lower);
        expect(parseEvmAddress(lower)).toStrictEqual({ ok: true, value: canonical });
        expect(parseEvmAddress(`0x${lower.slice(2).toUpperCase()}`)).toStrictEqual({
          ok: true,
          value: canonical,
        });
        expect(parseEvmAddress(canonical)).toStrictEqual({ ok: true, value: canonical });
      }),
    );
  });
});
