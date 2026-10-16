import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { ImageContentType } from "@binference/protocol";
import type { OwnerImageReader } from "../relay/ports.js";

/** An image reader under test, an agent's message, and three images it names. */
export interface OwnerImageReaderSubject {
  readonly reader: OwnerImageReader;
  readonly agent: Id<"agt">;
  readonly message: Id<"msg">;
  /** An image the message names and the engine holds. */
  readonly held: {
    readonly image: string;
    readonly contentType: ImageContentType;
    readonly bytes: Uint8Array;
  };
  /** An image the engine refuses as over 5 MiB. */
  readonly large: string;
  /** An image no message of the agent names. */
  readonly unnamed: string;
}

/** Makes a fresh subject for each check. */
export interface OwnerImageReaderHarness {
  create(): Promise<OwnerImageReaderSubject>;
}

const live = (): AbortSignal => new AbortController().signal;

/** The contract every `OwnerImageReader` adapter passes. */
export function ownerImageReaderContract(
  harness: OwnerImageReaderHarness,
): readonly ContractCheck[] {
  return [
    {
      name: "answers an image whole, in base64, with its format and size",
      run: async () => {
        const { reader, agent, message, held } = await harness.create();
        const read = await reader.read({ agent, message, image: held.image }, live());
        assert.ok(read.ok);
        assert.equal(read.value.contentType, held.contentType);
        assert.equal(read.value.bytes, held.bytes.byteLength);
        assert.equal(read.value.data, Buffer.from(held.bytes).toString("base64"));
      },
    },
    {
      name: "answers the engine's refusals: too large, and not named by the agent's message",
      run: async () => {
        const { reader, agent, message, large, unnamed } = await harness.create();
        const refused = await Promise.all(
          [large, unnamed].map(async (image) => reader.read({ agent, message, image }, live())),
        );
        assert.deepEqual(refused, [
          { ok: false, error: "too_large" },
          { ok: false, error: "not_found" },
        ]);
      },
    },
    {
      name: "rejects with the signal's reason once it aborts",
      run: async () => {
        const { reader, agent, message, held } = await harness.create();
        const reason = new Error("stopped");
        await assert.rejects(
          reader.read({ agent, message, image: held.image }, AbortSignal.abort(reason)),
          reason,
        );
      },
    },
  ];
}
