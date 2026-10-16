import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { OwnerImageSource } from "../chat/ports.js";

/** An image source under test, and the names of three images it holds or misses. */
export interface OwnerImageSourceSubject {
  readonly source: OwnerImageSource;
  /** An image the source holds, and its bytes. */
  readonly held: { readonly image: string; readonly bytes: Uint8Array };
  /** An image over 5 MiB. */
  readonly large: string;
  /** An image the source does not have. */
  readonly gone: string;
}

/** Makes a fresh subject for each check. */
export interface OwnerImageSourceHarness {
  create(): Promise<OwnerImageSourceSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** The contract every `OwnerImageSource` adapter passes. */
export function ownerImageSourceContract(
  harness: OwnerImageSourceHarness,
): readonly ContractCheck[] {
  return [
    {
      name: "reads an image's bytes as they are",
      run: async () => {
        const { source, held } = await harness.create();
        const read = await source.read(held.image, live());
        assert.ok(read.ok);
        assert.deepEqual([...read.value], [...held.bytes]);
      },
    },
    {
      name: "refuses an image over 5 MiB as too large",
      run: async () => {
        const { source, large } = await harness.create();
        assert.deepEqual(await source.read(large, live()), { ok: false, error: "too_large" });
      },
    },
    {
      name: "refuses an image it does not have as unreadable",
      run: async () => {
        const { source, gone } = await harness.create();
        assert.deepEqual(await source.read(gone, live()), { ok: false, error: "unreadable" });
      },
    },
    {
      name: "rejects with the signal's reason once it aborts",
      run: async () => {
        const { source, held } = await harness.create();
        const reason = new Error("stopped");
        await assert.rejects(
          source.read(held.image, { signal: AbortSignal.abort(reason) }),
          reason,
        );
      },
    },
  ];
}
