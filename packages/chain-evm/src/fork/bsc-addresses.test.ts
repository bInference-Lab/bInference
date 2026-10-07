import { bsc } from "@binference/chains";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { withFork } from "./with-fork.js";

const entries = [...bsc.tokens, ...bsc.contracts];

describe("the BSC registry", () => {
  it("holds code at every token and contract address at the pinned block", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const codes = await Promise.all(
        entries.map(async ({ address }) => ({
          address,
          code: await fork.client.getCode({ address: getAddress(address) }),
        })),
      );

      expect(entries.length).toBeGreaterThan(0);
      expect(codes.filter(({ code }) => code === undefined)).toStrictEqual([]);
    }));
});
