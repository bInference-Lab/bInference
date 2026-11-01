import { addressCodecContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { createSolanaAddressCodec } from "./solana-address-codec.js";

// The System Program, whose 32 bytes are all zero, and USDC's mint.
const system = "11111111111111111111111111111111";
const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const usdcBytes = "0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61";

describe("the Solana address codec", () => {
  it.each(
    addressCodecContract({
      create: () => ({
        codec: createSolanaAddressCodec(),
        namespace: "solana",
        samples: [
          { text: system, canonical: system, bytes: `0x${"00".repeat(32)}` },
          { text: usdc, canonical: usdc, bytes: usdcBytes },
        ],
        malformed: [
          "",
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4",
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v1",
          "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt10",
          "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
        ],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
