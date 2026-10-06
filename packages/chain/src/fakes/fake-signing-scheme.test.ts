import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { signingSchemeContract } from "../contracts/signing-scheme-contract.js";
import type { UnsignedTx } from "../transaction.js";
import { createFakeSigningScheme, signFake } from "./fake-signing-scheme.js";

const chain = chainRefSchema.parse("fake:1");
const unsigned: UnsignedTx = {
  chain,
  from: accountRefSchema.parse("fake:1:0x0000000a"),
  payload: "send|1",
};

describe("fake signing scheme", () => {
  it.each(
    signingSchemeContract({
      create: () => ({
        scheme: createFakeSigningScheme(),
        unsigned,
        signed: signFake(unsigned, "0x0000000a"),
        signedByOther: signFake(unsigned, "0x0000000b"),
        otherSigned: signFake({ ...unsigned, payload: "send|2" }, "0x0000000a"),
        malformed: { chain, raw: "nonsense" },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a signature made for another chain", () => {
    const other = { ...signFake(unsigned, "0x0000000a"), chain: chainRefSchema.parse("fake:2") };
    expect(createFakeSigningScheme().verify(unsigned, other)).toStrictEqual({
      ok: false,
      error: "other_transaction",
    });
  });
});
