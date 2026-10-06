import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { TxDraft } from "../transaction.js";
import { type DecodedEffect, decodedEffectSchema } from "../venues/decoded-effect.js";
import type { TxDecoder } from "../venues/ports.js";

/** A decoder under test, a trade call of its venue with its effect, and a draft it must refuse. */
export interface TxDecoderSubject {
  readonly decoder: TxDecoder;
  /** A trade call the venue built. */
  readonly draft: TxDraft;
  /** What `draft` does. */
  readonly effect: DecodedEffect;
  /** A draft that is none of the venue's trade calls, such as a token approval. */
  readonly foreign: TxDraft;
}

/** Makes a fresh {@link TxDecoderSubject} for each check. */
export interface TxDecoderHarness {
  create(): TxDecoderSubject;
}

/** The contract every `TxDecoder` passes. */
export function txDecoderContract(harness: TxDecoderHarness): readonly ContractCheck[] {
  return [
    {
      name: "decodes a trade call of its venue into what it does",
      run: async () => {
        const { decoder, draft, effect } = harness.create();
        const decoded = decoder.decode(draft);
        assert.deepEqual(decoded, { ok: true, value: effect });
        assert.ok(decodedEffectSchema.safeEncode(effect).success);
        assert.deepEqual(decoder.decode(draft), decoded);
        await Promise.resolve();
      },
    },
    {
      name: "answers a draft that is none of its trade calls as an unknown call",
      run: async () => {
        const { decoder, foreign } = harness.create();
        assert.deepEqual(decoder.decode(foreign), { ok: false, error: "unknown_call" });
        await Promise.resolve();
      },
    },
  ];
}
