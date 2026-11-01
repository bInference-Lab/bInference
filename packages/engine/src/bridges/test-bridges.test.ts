import { addressCodecContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { testHexCodec } from "./test-bridges.js";

describe("the test families' hex codec", () => {
  it.each(
    addressCodecContract({
      create: () => ({
        codec: testHexCodec("narrow", 20),
        namespace: "narrow",
        samples: [
          {
            text: `0x${"a1".repeat(20)}`,
            canonical: `0x${"a1".repeat(20)}`,
            bytes: `0x${"a1".repeat(20)}`,
          },
        ],
        malformed: ["", "0x1234", `0x${"a1".repeat(32)}`, `0x${"zz".repeat(20)}`],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
