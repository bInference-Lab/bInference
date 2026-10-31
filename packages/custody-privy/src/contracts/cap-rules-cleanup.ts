import assert from "node:assert/strict";
import type { Clock } from "@binference/core";
import { heldRules } from "../ceiling/held-rules.schema.js";
import type { PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";
import { readRuleRefs } from "../privy/privy-wire.schema.js";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";

/** What the cleanup needs of the suite's subject: Privy's API, the owner key and the time. */
interface CleanupSubject {
  readonly api: PrivyApi;
  readonly ownerAuthorize: OwnerAuthorize;
  readonly clock: Clock;
}

// A live signal for one call, cut off after a minute.
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(60_000) });

// How long a cleanup's change stays valid on Privy once the owner signs it.
const changeLifetimeMs = 5 * 60_000;

// Whether a rule Privy holds compares a 24-hour cap's sum.
function readsACap(json: Parameters<typeof heldRules>[0][number]): boolean {
  const [rule] = heldRules([json]) ?? [];
  return rule?.conditions.some((condition) => condition.fieldSource === "reference") === true;
}

/**
 * Takes out, with the owner key the suite made, every rule of the wallets' policies that compares a
 * 24-hour cap's sum, so the caps' aggregations can be deleted: Privy refuses to delete one a rule
 * still compares (409, seen on its test app on 2026-10-31).
 */
export async function removeCapRules(
  subject: CleanupSubject,
  wallets: readonly PrivyId[],
): Promise<void> {
  const { api } = subject;
  for (const wallet of wallets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet at a time, as every write
    const record = await api.wallet(wallet, live());
    for (const policy of record.ok ? record.value.policyIds : []) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one policy at a time
      const found = await api.policy(policy, live());
      const refs = (found.ok ? readRuleRefs(found.value.rules) : undefined) ?? [];
      for (const ref of refs.filter((item) => readsACap(item.json))) {
        const removal = {
          policy,
          rule: ref.id,
          expiresAtMs: subject.clock.now() + changeLifetimeMs,
        };
        // oxlint-disable-next-line eslint/no-await-in-loop -- one rule at a time
        const removed = await api.removeRule(removal, {
          authorization: { kind: "sign", authorize: subject.ownerAuthorize },
          ...live(),
        });
        assert.ok(removed.ok || removed.error === "not_found", `Privy kept rule ${ref.name}.`);
      }
    }
  }
}
