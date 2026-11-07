import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { ViewedImagePlace, ViewImageSource } from "../chat/ports.js";

/** A viewed image source under test, and places it reads or refuses. */
export interface ViewImageSourceSubject {
  readonly source: ViewImageSource;
  /** An image the source reads, and its bytes. */
  readonly held: { readonly place: ViewedImagePlace; readonly bytes: Uint8Array };
  /** A file that does not exist. */
  readonly missing: ViewedImagePlace;
  /** A file inside binference's own folder. */
  readonly walled: ViewedImagePlace;
  /** An address on a private network. */
  readonly private: ViewedImagePlace;
}

/** Makes a fresh subject for each check. */
export interface ViewImageSourceHarness {
  create(): Promise<ViewImageSourceSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** The contract every `ViewImageSource` adapter passes. */
export function viewImageSourceContract(harness: ViewImageSourceHarness): readonly ContractCheck[] {
  return [
    {
      name: "reads an image's bytes as they are",
      run: async () => {
        const { source, held } = await harness.create();
        const read = await source.read(held.place, live());
        assert.ok(read.ok);
        assert.deepEqual([...read.value], [...held.bytes]);
      },
    },
    {
      name: "refuses a file that does not exist, one in binference's folder and a private address",
      run: async () => {
        const subject = await harness.create();
        const reads = await Promise.all(
          [subject.missing, subject.walled, subject.private].map(async (place) =>
            subject.source.read(place, live()),
          ),
        );
        assert.deepEqual(reads, [
          { ok: false, error: "not_found" },
          { ok: false, error: "walled" },
          { ok: false, error: "not_public" },
        ]);
      },
    },
    {
      name: "rejects with the signal's reason once it aborts",
      run: async () => {
        const subject = await harness.create();
        const stopped = new Error("stopped");
        const stop = new AbortController();
        stop.abort(stopped);
        await assert.rejects(subject.source.read(subject.held.place, stop), stopped);
      },
    },
  ];
}
