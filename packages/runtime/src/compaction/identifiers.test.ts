import { describe, expect, it } from "vitest";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { missingIdentifiers } from "./identifiers.js";

const intent = nthTestId("int", 1);
const order = nthTestId("ord", 2);
const alert = nthTestId("alr", 3);
const schedule = nthTestId("sch", 4);
const hash = `0x${"ab".repeat(32)}`;
const address = `0x${"aB".repeat(20)}`;

describe("missingIdentifiers", () => {
  it("names every id, hash and address of the compacted texts the summary left out", () => {
    const compacted = [
      `Proposed ${intent}; order ${order}, alert ${alert}, schedule ${schedule}.`,
      `Sent ${hash} to ${address}.`,
    ];
    expect(missingIdentifiers({ compacted, kept: [], summary: "" })).toStrictEqual([
      intent,
      order,
      alert,
      schedule,
      hash,
      address,
    ]);
  });

  it("finds nothing missing when the summary holds each one", () => {
    const compacted = [`${intent} ${hash} ${address}`];
    const summary = `Intent ${intent} filled in ${hash}; token ${address}.`;
    expect(missingIdentifiers({ compacted, kept: [], summary })).toStrictEqual([]);
  });

  it("accepts one that stays in the kept texts", () => {
    const compacted = [`Proposed ${intent}.`];
    expect(
      missingIdentifiers({ compacted, kept: [`Card for ${intent}`], summary: "" }),
    ).toStrictEqual([]);
  });

  it("matches an address in any letter case, and ids and hashes only exactly", () => {
    const compacted = [`${address} ${hash}`];
    const summary = `${address.toLowerCase()} ${hash.toUpperCase().replace("0X", "0x")}`;
    expect(missingIdentifiers({ compacted, kept: [], summary })).toStrictEqual([hash]);
  });

  it("reads a hash whole, not as an address inside it, and skips other ids", () => {
    const compacted = [`${hash} ${nthTestId("wal", 5)} ${nthTestId("trn", 6)} 0x1234`];
    expect(missingIdentifiers({ compacted, kept: [], summary: "" })).toStrictEqual([hash]);
  });

  it("names each missing one once", () => {
    const compacted = [intent, `again ${intent}`];
    expect(missingIdentifiers({ compacted, kept: [], summary: "" })).toStrictEqual([intent]);
  });
});
