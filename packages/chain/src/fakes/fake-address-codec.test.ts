import { describe, expect, it } from "vitest";
import { addressCodecContract } from "../contracts/address-codec-contract.js";
import { createFakeAddressCodec } from "./fake-address-codec.js";

describe("fake address codec", () => {
  it.each(
    addressCodecContract({
      create: () => ({
        codec: createFakeAddressCodec(),
        namespace: "fake",
        samples: [
          { text: "0x0000A1B2", canonical: "0x0000a1b2", bytes: "0x0000a1b2" },
          { text: "0xffffffff", canonical: "0xffffffff", bytes: "0xffffffff" },
        ],
        malformed: ["", "0x1234", "0x0000a1b2c3", "0000a1b2", "0xzzzzzzzz"],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
