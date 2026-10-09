import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { accountRefParts } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { DraftCall } from "../draft-call.js";
import type { ChainFamily } from "../ports.js";
import type { TokenTransfer } from "../token-transfer.js";
import type { TxDraft } from "../transaction.js";

/** An address as written, and the canonical form its family gives it. */
export interface AddressSample {
  readonly text: string;
  readonly canonical: string;
}

/** A draft of the family, and what the family must read from it. */
export interface DraftSample {
  readonly draft: TxDraft;
  readonly call: DraftCall;
}

/** A family under test, with addresses and drafts it must read and inputs it must refuse. */
export interface ChainFamilySubject {
  readonly family: ChainFamily;
  readonly addresses: readonly AddressSample[];
  readonly malformed: readonly string[];
  /** Drafts it reads: at least one plain call and one token approval. */
  readonly drafts: readonly DraftSample[];
  /** Drafts it cannot read: bytes of no call, or a draft of another family. */
  readonly unreadable: readonly TxDraft[];
  /** A chain of the family, to make fresh accounts on. */
  readonly chain: ChainRef;
  /** A token transfer it drafts, and the call it reads back from that draft. */
  readonly transfer: { readonly transfer: TokenTransfer; readonly call: DraftCall };
  /** A transfer of an asset it cannot send with its token standard, such as the native coin. */
  readonly unsendable: TokenTransfer;
}

/** Makes a fresh {@link ChainFamilySubject} for each check. */
export interface ChainFamilyHarness {
  create(): ChainFamilySubject;
}

function draftChecks(harness: ChainFamilyHarness): readonly ContractCheck[] {
  return [
    {
      name: "reads where a draft calls, the coin it sends and the approval it grants",
      run: async () => {
        const { family, drafts } = harness.create();
        assert.ok(drafts.some(({ call }) => call.approval === undefined));
        assert.ok(drafts.some(({ call }) => call.approval !== undefined));
        for (const { draft, call } of drafts) {
          assert.deepEqual(family.readDraft(draft), { ok: true, value: call });
        }
        await Promise.resolve();
      },
    },
    {
      name: "refuses a draft it cannot read as an expected failure",
      run: async () => {
        const { family, unreadable } = harness.create();
        assert.ok(unreadable.length > 0);
        for (const draft of unreadable) {
          assert.deepEqual(family.readDraft(draft), { ok: false, error: "malformed_draft" });
        }
        await Promise.resolve();
      },
    },
  ];
}

function seedOf(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function simulationChecks(harness: ChainFamilyHarness): readonly ContractCheck[] {
  return [
    {
      name: "makes one fresh account per seed, on the chain it is asked for, in canonical form",
      run: async () => {
        const { family, chain } = harness.create();
        const first = family.freshAccount(chain, seedOf(1));
        const parts = accountRefParts(first);
        assert.equal(parts.chain, chain);
        assert.deepEqual(family.parseAddress(parts.address), { ok: true, value: parts.address });
        assert.equal(family.freshAccount(chain, seedOf(1)), first);
        assert.notEqual(family.freshAccount(chain, seedOf(2)), first);
        await Promise.resolve();
      },
    },
    {
      name: "drafts a token transfer from its sender that it reads as a plain call to the token",
      run: async () => {
        const { family, transfer } = harness.create();
        const draft = family.transferDraft(transfer.transfer);
        assert.ok(draft.ok);
        assert.equal(draft.value.from, transfer.transfer.from);
        assert.deepEqual(family.readDraft(draft.value), { ok: true, value: transfer.call });
        await Promise.resolve();
      },
    },
    {
      name: "refuses to draft a transfer of an asset its token standard cannot send",
      run: async () => {
        const { family, unsendable } = harness.create();
        assert.deepEqual(family.transferDraft(unsendable), { ok: false, error: "unknown_asset" });
        await Promise.resolve();
      },
    },
  ];
}

/** The contract every `ChainFamily` passes. */
export function chainFamilyContract(harness: ChainFamilyHarness): readonly ContractCheck[] {
  return [
    {
      name: "names its id and a CAIP-2 namespace",
      run: async () => {
        const { family } = harness.create();
        assert.match(family.id, /^[a-z][a-z0-9-]*$/);
        assert.match(family.namespace, /^[-a-z0-9]{3,8}$/);
        await Promise.resolve();
      },
    },
    {
      name: "gives the canonical form of every address it accepts",
      run: async () => {
        const { family, addresses } = harness.create();
        assert.ok(addresses.length > 0);
        for (const { text, canonical } of addresses) {
          assert.deepEqual(family.parseAddress(text), { ok: true, value: canonical });
          assert.deepEqual(family.parseAddress(canonical), { ok: true, value: canonical });
        }
        await Promise.resolve();
      },
    },
    {
      name: "refuses malformed text as an expected failure",
      run: async () => {
        const { family, malformed } = harness.create();
        assert.ok(malformed.length > 0);
        for (const text of malformed) {
          assert.deepEqual(family.parseAddress(text), { ok: false, error: "malformed_address" });
        }
        await Promise.resolve();
      },
    },
    ...draftChecks(harness),
    ...simulationChecks(harness),
  ];
}
