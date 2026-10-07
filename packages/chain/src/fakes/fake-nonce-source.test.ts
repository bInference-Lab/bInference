import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { nonceSourceContract } from "../contracts/nonce-source-contract.js";
import { createFakeNonceSource } from "./fake-nonce-source.js";

const account = accountRefSchema.parse("fake:1:0x0000000a");
const unseen = accountRefSchema.parse("fake:1:0x0000000b");
const live = { signal: new AbortController().signal };

describe("fake nonce source", () => {
  it.each(
    nonceSourceContract({
      create: async () =>
        await Promise.resolve({
          source: createFakeNonceSource(new Map([[account, 7]])),
          known: { account, next: 7 },
          unseen,
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("gives the count a test set, as a new block would move it", async () => {
    const source = createFakeNonceSource(new Map());
    source.set(account, 12);
    await expect(source.next(account, live)).resolves.toBe(12);
  });

  it.each([-1, 1.5, 2 ** 53])("refuses %d as a count", (next) => {
    expect(() => createFakeNonceSource(new Map([[account, next]]))).toThrow(
      expect.objectContaining({ code: "chain.bad_nonce" }),
    );
    expect(() => {
      createFakeNonceSource(new Map()).set(account, next);
    }).toThrow(expect.objectContaining({ code: "chain.bad_nonce" }));
  });
});
