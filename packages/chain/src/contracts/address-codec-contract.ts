import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AddressCodec } from "../addresses/ports.js";
import { recipientHex } from "../addresses/recipient-bytes.js";

/** An address as written, its canonical form, and its recipient bytes as lowercase hex. */
export interface CodecSample {
  readonly text: string;
  readonly canonical: string;
  readonly bytes: string;
}

/**
 * A codec under test: addresses it reads, text it must refuse, among it addresses of other
 * families, and its namespace.
 */
export interface AddressCodecSubject {
  readonly codec: AddressCodec;
  readonly namespace: string;
  readonly samples: readonly CodecSample[];
  readonly malformed: readonly string[];
}

/** Makes a fresh {@link AddressCodecSubject} for each check. */
export interface AddressCodecHarness {
  create(): AddressCodecSubject;
}

const refused = { ok: false, error: "malformed_address" };

async function readsSamples(harness: AddressCodecHarness): Promise<void> {
  const { codec, namespace, samples } = harness.create();
  assert.equal(codec.namespace, namespace);
  assert.ok(samples.length > 0);
  for (const { text, canonical } of samples) {
    assert.deepEqual(codec.parse(text), { ok: true, value: canonical });
    assert.deepEqual(codec.parse(canonical), { ok: true, value: canonical });
  }
  await Promise.resolve();
}

async function convertsBytes(harness: AddressCodecHarness): Promise<void> {
  const { codec, samples } = harness.create();
  for (const { text, canonical, bytes } of samples) {
    const made = codec.toBytes(text);
    assert.ok(made.ok);
    assert.equal(made.value.length, codec.recipientLength);
    assert.equal(recipientHex(made.value), bytes);
    assert.deepEqual(codec.fromBytes(made.value), { ok: true, value: canonical });
  }
  await Promise.resolve();
}

async function refusesMalformed(harness: AddressCodecHarness): Promise<void> {
  const { codec, malformed } = harness.create();
  assert.ok(malformed.length > 0);
  for (const text of malformed) {
    assert.deepEqual(codec.parse(text), refused);
    assert.deepEqual(codec.toBytes(text), refused);
  }
  await Promise.resolve();
}

async function refusesOtherLengths(harness: AddressCodecHarness): Promise<void> {
  const { codec } = harness.create();
  for (const length of [0, codec.recipientLength - 1, codec.recipientLength + 1, 64]) {
    assert.deepEqual(codec.fromBytes(new Uint8Array(length)), refused);
  }
  await Promise.resolve();
}

/** The contract every `AddressCodec` adapter passes. */
export function addressCodecContract(harness: AddressCodecHarness): readonly ContractCheck[] {
  return [
    {
      name: "reads each address into its canonical form, which reads as itself",
      run: async () => readsSamples(harness),
    },
    {
      name: "gives each address its recipient bytes and reads them back",
      run: async () => convertsBytes(harness),
    },
    {
      name: "refuses text that is no address of its family",
      run: async () => refusesMalformed(harness),
    },
    {
      name: "refuses bytes of another length",
      run: async () => refusesOtherLengths(harness),
    },
  ];
}
