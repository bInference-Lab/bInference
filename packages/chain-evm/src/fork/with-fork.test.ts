import { getAddress, keccak256, slice, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { withFork } from "./with-fork.js";

const oneBnb = 10n ** 18n;
// A fresh address: no code on BSC, no key anywhere; anvil sends for it once impersonated.
const sender = getAddress(slice(keccak256(toHex("binference fork sender")), 12));

describe("withFork", () => {
  it("clears the test account's code, so the BNB sent to it stays there", async ({ signal }) =>
    withFork(signal, async (fork) => {
      const { account, client } = fork;
      await expect(client.getCode({ address: account })).resolves.toBeUndefined();
      await fork.call("anvil_setBalance", [sender, toHex(2n * oneBnb)]);
      await fork.call("anvil_impersonateAccount", [sender]);
      const before = await client.getBalance({ address: account });

      const receipt = await fork.send({ from: sender, to: account, value: oneBnb });

      expect(receipt.status).toBe("success");
      await expect(client.getBalance({ address: account })).resolves.toBe(before + oneBnb);
    }));

  // Runs after a test that mined a block and moved BNB: withFork reverted both.
  it("starts each test on BSC at the pinned block, with nothing mined after it", async ({
    signal,
  }) =>
    withFork(signal, async (fork) => {
      const { account, client } = fork;
      await expect(client.getChainId()).resolves.toBe(fork.chain.chainId);
      await expect(client.getBlockNumber()).resolves.toBe(fork.block);
      await expect(client.getBalance({ address: account })).resolves.toBe(10n * oneBnb);
    }));
});
