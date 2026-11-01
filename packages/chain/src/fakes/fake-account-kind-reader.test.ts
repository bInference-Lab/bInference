import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { accountKindReaderContract } from "../contracts/account-kind-reader-contract.js";
import { createFakeAccountKindReader } from "./fake-account-kind-reader.js";

const chain = chainRefSchema.parse("fake:2");
const program = accountRefSchema.parse("fake:2:0x000000c1");
const tokenAccount = accountRefSchema.parse("fake:2:0x000000c2");
const derived = accountRefSchema.parse("fake:2:0x000000c3");
const nonce = accountRefSchema.parse("fake:2:0x000000c4");
const wallet = accountRefSchema.parse("fake:2:0x000000a1");
const live = { signal: new AbortController().signal };

describe("fake account kind reader", () => {
  it.each(
    accountKindReaderContract({
      create: async () =>
        await Promise.resolve({
          reader: createFakeAccountKindReader({
            chain,
            notWallets: [program, tokenAccount, derived, nonce],
          }),
          wallet,
          fresh: accountRefSchema.parse("fake:2:0x000000a2"),
          program,
          tokenAccount,
          derived,
          nonce,
          stranger: accountRefSchema.parse("fake:1:0x000000a1"),
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("rejects while its chain is down and reads again once it is up", async () => {
    const reader = createFakeAccountKindReader({ chain, notWallets: [] });
    reader.down();
    await expect(reader.read(wallet, live)).rejects.toMatchObject({ code: "chain.unreachable" });
    reader.up();
    await expect(reader.read(wallet, live)).resolves.toBe("wallet");
  });
});
