import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { checkReasons } from "../intents/intent-reason.js";
import type { QuoteSource } from "../ports.js";

/** A quote source under test, an intent it can quote again, and one it cannot. */
export interface QuoteSourceSubject {
  readonly source: QuoteSource;
  readonly quotable: Id<"int">;
  readonly unquotable: Id<"int">;
}

/** Makes a fresh {@link QuoteSourceSubject} for each check. */
export interface QuoteSourceHarness {
  create(): QuoteSourceSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const checkReasonSet: ReadonlySet<string> = new Set(checkReasons);

/** The contract every `QuoteSource` adapter passes. */
export function quoteSourceContract(harness: QuoteSourceHarness): readonly ContractCheck[] {
  return [
    {
      name: "quotes an intent again with a minimum out and the steps built from it",
      run: async () => {
        const { source, quotable } = harness.create();
        const built = await source.requote(quotable, live());
        assert.ok(built.ok);
        assert.ok(built.value.steps.length > 0);
        assert.ok(built.value.quote.minOut.base >= 0n);
        assert.ok(built.value.quote.expiresAt >= built.value.quote.quotedAt);
      },
    },
    {
      name: "answers an intent it cannot quote with a check reason",
      run: async () => {
        const { source, unquotable } = harness.create();
        const built = await source.requote(unquotable, live());
        assert.ok(!built.ok);
        assert.ok(checkReasonSet.has(built.error));
      },
    },
    {
      name: "refuses to quote on an aborted signal",
      run: async () => {
        const { source, quotable } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(
          source.requote(quotable, { signal: AbortSignal.abort(reason) }),
          reason,
        );
      },
    },
  ];
}
