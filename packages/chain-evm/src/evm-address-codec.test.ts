import { addressCodecContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { createEvmAddressCodec } from "./evm-address-codec.js";

const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const bytes = checksummed.toLowerCase();

describe("evm address codec", () => {
  it.each(
    addressCodecContract({
      create: () => ({
        codec: createEvmAddressCodec(),
        namespace: "eip155",
        samples: [
          { text: checksummed, canonical: checksummed, bytes },
          { text: bytes, canonical: checksummed, bytes },
          { text: `0x${checksummed.slice(2).toUpperCase()}`, canonical: checksummed, bytes },
        ],
        malformed: [
          "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD",
          "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beae",
          "5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
          "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          "",
        ],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
