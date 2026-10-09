import assert from "node:assert/strict";
import { BinferenceError } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { z } from "zod";
import type { AssetRef } from "../caip/asset-ref.js";
import type { TokenRiskSource } from "../risk/ports.js";
import { tokenRiskReportSchema } from "../risk/risk-report.js";

/** A risk source under test, with a token it reports on and one it has no answer for. */
export interface TokenRiskSourceSubject {
  readonly source: TokenRiskSource;
  /** A token the source reports on. */
  readonly known: AssetRef;
  /** A token or chain the source has no answer for. */
  readonly unknown: AssetRef;
  /** The same source over a service that is down. */
  readonly down: TokenRiskSource;
}

/** Makes a fresh {@link TokenRiskSourceSubject} for each check. */
export interface TokenRiskSourceHarness {
  create(): TokenRiskSourceSubject;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

/** The contract every `TokenRiskSource` adapter passes. */
export function tokenRiskSourceContract(harness: TokenRiskSourceHarness): readonly ContractCheck[] {
  return [
    {
      name: "reports a known token with findings that survive JSON",
      run: async () => {
        const { source, known } = harness.create();
        const report = await source.check(known, live());
        assert.ok(report.ok);
        const wire = z.encode(tokenRiskReportSchema, report.value);
        assert.deepEqual(
          tokenRiskReportSchema.parse(JSON.parse(JSON.stringify(wire))),
          report.value,
        );
        assert.match(source.id, /^[a-z][a-z0-9_]*$/);
      },
    },
    {
      name: "answers not_covered for a token it has no answer for",
      run: async () => {
        const { source, unknown } = harness.create();
        assert.deepEqual(await source.check(unknown, live()), { ok: false, error: "not_covered" });
      },
    },
    {
      name: "rejects with a binference error when its service is down",
      run: async () => {
        const { down, known } = harness.create();
        await assert.rejects(down.check(known, live()), BinferenceError);
      },
    },
    {
      name: "rejects with the signal's reason once the signal aborts",
      run: async () => {
        const { source, known } = harness.create();
        const reason = new Error("stopped");
        await assert.rejects(source.check(known, { signal: AbortSignal.abort(reason) }), reason);
      },
    },
  ];
}
