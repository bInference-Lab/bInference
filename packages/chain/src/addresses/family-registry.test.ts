import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { createFakeAddressCodec } from "../fakes/fake-address-codec.js";
import { createFamilyRegistry } from "./family-registry.js";
import { recipientBytesOf, recipientHex, recipientHexBytes } from "./recipient-bytes.js";

const families = createFamilyRegistry([createFakeAddressCodec()]);

describe("the chain family registry", () => {
  it("finds a chain's codec by its namespace, whichever chain of the family", () => {
    const [codec] = families.codecs;
    expect(families.codecOf(chainRefSchema.parse("fake:1"))).toStrictEqual({
      ok: true,
      value: codec,
    });
    expect(families.codecOf(chainRefSchema.parse("fake:9"))).toStrictEqual({
      ok: true,
      value: codec,
    });
    expect(families.codecOf(chainRefSchema.parse("other:1"))).toStrictEqual({
      ok: false,
      error: "unknown_family",
    });
  });

  it("refuses two codecs of one namespace", () => {
    expect(() =>
      createFamilyRegistry([createFakeAddressCodec(), createFakeAddressCodec()]),
    ).toThrow(expect.objectContaining({ code: "chain.duplicate_family" }));
  });
});

describe("recipient bytes", () => {
  it("gives an account's bytes as lowercase hex through its family's codec", () => {
    const account = accountRefSchema.parse("fake:1:0x0000A1B2");
    expect(recipientBytesOf(families, account)).toStrictEqual({ ok: true, value: "0x0000a1b2" });
  });

  it("refuses an account no family serves, or one its codec refuses", () => {
    expect(recipientBytesOf(families, accountRefSchema.parse("other:1:0x0000a1b2"))).toStrictEqual({
      ok: false,
      error: "unknown_family",
    });
    expect(recipientBytesOf(families, accountRefSchema.parse("fake:1:0x12"))).toStrictEqual({
      ok: false,
      error: "malformed_address",
    });
  });

  it("reads lowercase hex back to its bytes and refuses any other text", () => {
    const bytes = Uint8Array.from([0, 161, 255]);
    const hex = recipientHex(bytes);
    expect(hex).toBe("0x00a1ff");
    expect(recipientHexBytes(hex)).toStrictEqual({ ok: true, value: bytes });
    for (const text of ["0x00A1FF", "00a1ff", "0x0a1", "0x"]) {
      expect(recipientHexBytes(text)).toStrictEqual({ ok: false, error: "malformed_hex" });
    }
  });
});
