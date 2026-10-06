import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { accountRefParts } from "../caip/account-ref.js";
import { txDraftSchema } from "../transaction.js";
import type { BuildRequest } from "../venues/build-request.js";
import type { TxBuilder } from "../venues/ports.js";

/** A builder under test and a request it can build. */
export interface TxBuilderSubject {
  readonly builder: TxBuilder;
  readonly request: BuildRequest;
}

/** Makes a fresh {@link TxBuilderSubject} for each check. */
export interface TxBuilderHarness {
  create(): TxBuilderSubject;
}

const live = (): AbortSignal => new AbortController().signal;

/** The contract every `TxBuilder` passes. */
export function txBuilderContract(harness: TxBuilderHarness): readonly ContractCheck[] {
  return [
    {
      name: "builds well-formed drafts from the request's wallet on its chain",
      run: async () => {
        const { builder, request } = harness.create();
        const drafts = await builder.build(request, { signal: live() });
        assert.ok(drafts.length > 0);
        for (const draft of drafts) {
          assert.ok(txDraftSchema.safeEncode(draft).success);
          assert.equal(draft.from, request.wallet);
          assert.equal(draft.chain, accountRefParts(request.wallet).chain);
        }
      },
    },
    {
      name: "refuses to build on an aborted signal",
      run: async () => {
        const { builder, request } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(builder.build(request, { signal: AbortSignal.abort(reason) }), reason);
      },
    },
  ];
}
