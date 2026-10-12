import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { accountRefParts } from "../caip/account-ref.js";
import { assetRefParts } from "../caip/asset-ref.js";
import type { PriceReader } from "../venues/ports.js";
import type { PriceReadRequest, ReadAnswer } from "../venues/price-read.js";

/** A price reader under test, a token it prices with answers that price it, and one it cannot. */
export interface PriceReaderSubject {
  readonly reader: PriceReader;
  /** A token the reader prices. */
  readonly priced: PriceReadRequest;
  /** Answers the priced token's calls could get at a block, in their order, which price it. */
  readonly answers: readonly ReadAnswer[];
  /** A token the reader cannot price. */
  readonly unpriced: PriceReadRequest;
}

/** Makes a fresh {@link PriceReaderSubject} for each check. */
export interface PriceReaderHarness {
  create(): PriceReaderSubject;
}

const live = (): AbortSignal => new AbortController().signal;

async function readOf(subject: PriceReaderSubject) {
  const read = await subject.reader.priceRead(subject.priced, { signal: live() });
  assert.ok(read.ok);
  return read.value;
}

const readChecks = (harness: PriceReaderHarness): readonly ContractCheck[] => [
  {
    name: "reads a token through calls on its chain, in another asset of that chain",
    run: async () => {
      const subject = harness.create();
      const read = await readOf(subject);
      const chain = assetRefParts(subject.priced.token).chain;
      assert.ok(read.calls.length > 0);
      for (const call of read.calls) {
        assert.equal(accountRefParts(call.target).chain, chain);
      }
      assert.equal(assetRefParts(read.quoteAsset).chain, chain);
      assert.notEqual(read.quoteAsset, subject.priced.token);
    },
  },
  {
    name: "prices the answers of its calls above zero",
    run: async () => {
      const subject = harness.create();
      const price = (await readOf(subject)).price(subject.answers);
      assert.ok(price.ok);
      assert.ok(price.value.numerator > 0n && price.value.denominator > 0n);
    },
  },
  {
    name: "answers failed calls or missing answers as unpriced, never a throw",
    run: async () => {
      const read = await readOf(harness.create());
      const unpriced = { ok: false, error: "unpriced" };
      assert.deepEqual(read.price(read.calls.map(() => undefined)), unpriced);
      assert.deepEqual(read.price([]), unpriced);
    },
  },
];

const refusalChecks = (harness: PriceReaderHarness): readonly ContractCheck[] => [
  {
    name: "answers a token it cannot price as no_price_read",
    run: async () => {
      const { reader, unpriced } = harness.create();
      assert.deepEqual(await reader.priceRead(unpriced, { signal: live() }), {
        ok: false,
        error: "no_price_read",
      });
    },
  },
  {
    name: "refuses to read on an aborted signal",
    run: async () => {
      const { reader, priced } = harness.create();
      const reason = new Error("stopped");
      await assert.rejects(reader.priceRead(priced, { signal: AbortSignal.abort(reason) }), reason);
    },
  },
];

/** The contract every `PriceReader` passes. */
export function priceReaderContract(harness: PriceReaderHarness): readonly ContractCheck[] {
  return [...readChecks(harness), ...refusalChecks(harness)];
}
