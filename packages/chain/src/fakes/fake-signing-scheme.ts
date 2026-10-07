import { err, ok } from "@binference/core";
import { accountRefParts } from "../caip/account-ref.js";
import type { SigningScheme } from "../ports.js";
import { isTxHash, type SignedTx, type UnsignedTx } from "../transaction.js";

const prefix = "fake-signed";

/** Signs a transaction the way the fake scheme expects, for tests. */
export function signFake(unsigned: UnsignedTx, address: string): SignedTx {
  return { chain: unsigned.chain, raw: [prefix, address, unsigned.payload].join("|") };
}

/** The hash of a fake signed transaction: FNV-1a over its raw text, stable and short. */
export function fakeTxHash(raw: string): string {
  let hash = 0x811c9dc5;
  for (const char of raw) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return `fake${hash.toString(16).padStart(8, "0")}`;
}

/** Creates the signing scheme of the fake family, for tests. */
export function createFakeSigningScheme(): SigningScheme {
  return {
    family: "fake",
    verify(unsigned, signed) {
      const [mark, signer, ...payload] = signed.raw.split("|");
      const hash = fakeTxHash(signed.raw);
      if (mark !== prefix || signer === undefined || !isTxHash(hash)) {
        return err("malformed_signature");
      }
      if (payload.join("|") !== unsigned.payload || signed.chain !== unsigned.chain) {
        return err("other_transaction");
      }
      return signer === accountRefParts(unsigned.from).address ? ok(hash) : err("other_signer");
    },
  };
}
