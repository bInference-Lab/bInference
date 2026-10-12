import assert from "node:assert/strict";
import { type AssetRef, assetRefParts } from "@binference/chain";
import type { ContractCheck } from "@binference/core/testing";
import type { MarketReads } from "../market/ports.js";

/** Market reads under test, with what their sources know and what they do not. */
export interface MarketReadsSubject {
  readonly reads: MarketReads;
  /** A token some source knows pools of, on a chain with trending tokens. */
  readonly known: AssetRef;
  /** A token no source knows anything of. */
  readonly unknown: AssetRef;
  /** The same reads over sources that are all down. */
  readonly down: MarketReads;
}

/** Makes a fresh {@link MarketReadsSubject} for each check. */
export interface MarketReadsHarness {
  create(): MarketReadsSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** The contract every `MarketReads` adapter passes. */
export function marketReadsContract(harness: MarketReadsHarness): readonly ContractCheck[] {
  return [
    {
      name: "reads a known token's pools and its chain's trending tokens, naming the source",
      run: async () => {
        const { reads, known } = harness.create();
        const pools = await reads.pools(known, live());
        const trending = await reads.trending(assetRefParts(known).chain, live());
        assert.ok(pools.ok && trending.ok);
        assert.ok(pools.value.items.length > 0 && trending.value.items.length > 0);
        assert.match(pools.value.source, /^[a-z][a-z0-9-]{0,31}$/);
        assert.match(trending.value.source, /^[a-z][a-z0-9-]{0,31}$/);
      },
    },
    {
      name: "answers no_data for a token no source knows anything of",
      run: async () => {
        const { reads, unknown } = harness.create();
        assert.deepEqual(await reads.pools(unknown, live()), { ok: false, error: "no_data" });
      },
    },
    {
      name: "answers source_down when the sources are down",
      run: async () => {
        const { down, known } = harness.create();
        const expected = { ok: false, error: "source_down" };
        assert.deepEqual(await down.pools(known, live()), expected);
        assert.deepEqual(await down.trending(assetRefParts(known).chain, live()), expected);
      },
    },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => {
        const { reads, known } = harness.create();
        const controller = new AbortController();
        const reason = new Error("stopped");
        controller.abort(reason);
        await assert.rejects(reads.pools(known, { signal: controller.signal }), reason);
        await assert.rejects(
          reads.trending(assetRefParts(known).chain, { signal: controller.signal }),
          reason,
        );
      },
    },
  ];
}
