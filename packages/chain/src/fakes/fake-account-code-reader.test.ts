import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { accountCodeReaderContract } from "../contracts/account-code-reader-contract.js";
import { createFakeAccountCodeReader } from "./fake-account-code-reader.js";

const chain = chainRefSchema.parse("fake:2");
const plain = accountRefSchema.parse("fake:2:0x000000a1");
const delegated = accountRefSchema.parse("fake:2:0x000000a2");
const token = accountRefSchema.parse("fake:2:0x000000c1");
const contract = accountRefSchema.parse("fake:2:0x000000c2");
const live = { signal: new AbortController().signal };

describe("fake account code reader", () => {
  it.each(
    accountCodeReaderContract({
      create: async () =>
        await Promise.resolve({
          reader: createFakeAccountCodeReader({
            chain,
            codes: new Map([
              [delegated, "delegation"],
              [token, "token"],
              [contract, "contract"],
            ]),
          }),
          plain,
          delegated,
          token,
          contract,
          stranger: accountRefSchema.parse("fake:1:0x000000a1"),
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads code placed later, and rejects while its chain is down", async () => {
    const reader = createFakeAccountCodeReader({ chain });
    reader.place(plain, "contract");
    await expect(reader.read(plain, live)).resolves.toBe("contract");
    reader.down();
    await expect(reader.read(plain, live)).rejects.toMatchObject({ code: "chain.unreachable" });
    reader.up();
    await expect(reader.read(delegated, live)).resolves.toBe("none");
  });
});
