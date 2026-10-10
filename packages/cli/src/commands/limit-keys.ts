import { type ChainRef, type ChainRegistry, isChainRef } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import { type LimitField, type LimitUnit, limitUnits } from "@binference/engine/surfaces";
import { type LimitChanges, limitChangesSchema } from "@binference/protocol";
import { usdSchema } from "../config/schema/value-formats.schema.js";
import { baseUnitsOf } from "../init/base-units.js";

/** The key `defaults` gives each limit in config.json5, in the units the limit is set in. */
export const limitConfigKeys: Readonly<Record<LimitField, string>> = {
  perTradeUsdMicros: "limits.perTradeUsd",
  rollingDayUsdMicros: "limits.rollingDayUsd",
  slippageRegistryBps: "limits.slippageBps.registry",
  slippageOtherBps: "limits.slippageBps.other",
  priceImpactBps: "limits.priceImpactBps",
  taxBps: "limits.taxBps",
  liquidityFloorUsdMicros: "limits.liquidityFloorUsd",
  minHealthFactorBps: "limits.minHealthFactor",
  venues: "limits.venues",
  allowTokens: "limits.allowTokens",
  denyTokens: "limits.denyTokens",
  modelBudgetUsdMicros: "modelBudgetUsdPerDay",
  cardTradeExpirySeconds: "cards.tradeExpirySec",
  cardOtherExpirySeconds: "cards.otherExpirySec",
  requoteAfterSeconds: "cards.requoteAfterSec",
  requoteToleranceBps: "cards.requoteToleranceBps",
  orderExpiryDays: "orders.expiryDays",
  copyPerBuyUsdMicros: "copy.perBuyUsd",
  copyPerLeaderDayUsdMicros: "copy.perLeaderDayUsd",
};

/** A limit the CLI names: its key under config.json5's `defaults`, its field and its unit. */
interface LimitKey {
  readonly key: string;
  readonly field: LimitField;
  readonly kind: LimitUnit;
}

// Every limit but the gas reserve, by the key `defaults` gives it in config.json5 and in the same
// units: dollars, basis points, seconds, days, a health factor, or a comma-separated list. The gas
// reserve of a chain is `limits.gasReserve.<chain>`, in its native coin.
const limitKeys: readonly LimitKey[] = limitUnits.map(({ field, unit }) => ({
  key: limitConfigKeys[field],
  field,
  kind: unit,
}));

/** The gas reserve's key prefix: `limits.gasReserve.eip155:56=0.003`. */
export const gasReserveKey = "limits.gasReserve";

/** Why a `key=value` cannot change a limit. */
type LimitSetProblem =
  | { readonly kind: "bad_set"; readonly set: string }
  | { readonly kind: "bad_value"; readonly key: string; readonly value: string };

/** The changes the sets make, or the first set that cannot change a limit and why. */
export type LimitSetOutcome =
  | { readonly ok: true; readonly value: LimitChanges }
  | { readonly ok: false; readonly problem: LimitSetProblem };

const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const whole = /^(?:0|[1-9]\d{0,9})$/;
const bpPerOne = 10_000;

function usdWire(text: string): JsonValue | undefined {
  const micros = decimal.test(text) ? usdSchema.safeParse(Number(text)) : undefined;
  return micros?.success === true ? micros.data.toString() : undefined;
}

function wholeWire(text: string): JsonValue | undefined {
  return whole.test(text) ? Number(text) : undefined;
}

function healthFactorWire(text: string): JsonValue | undefined {
  return decimal.test(text) ? Math.round(Number(text) * bpPerOne) : undefined;
}

function listWire(text: string): JsonValue {
  return text === "" ? [] : text.split(",").map((item) => item.trim());
}

// How each kind's text becomes the value `limit/set` takes on the wire; `undefined` when it
// cannot.
const wireOf: Readonly<Record<LimitUnit, (text: string) => JsonValue | undefined>> = {
  usd: usdWire,
  bps: wholeWire,
  seconds: wholeWire,
  days: wholeWire,
  healthFactor: healthFactorWire,
  list: listWire,
};

function gasReserveOf(chains: ChainRegistry, chain: string, text: string): JsonValue | undefined {
  const registered = isChainRef(chain) ? chains.get(chain) : undefined;
  const base =
    registered?.ok === true
      ? baseUnitsOf(text, registered.value.definition.nativeAsset.decimals)
      : undefined;
  return base === undefined ? undefined : { [chain]: base.toString() };
}

// One `key=value` as the changes it makes, each checked by the protocol's own schema.
function changeOf(chains: ChainRegistry, set: string): LimitSetOutcome {
  const split = set.indexOf("=");
  const key = split <= 0 ? "" : set.slice(0, split);
  const value = set.slice(split + 1);
  const named = limitKeys.find((entry) => entry.key === key);
  const isGas = key.startsWith(`${gasReserveKey}.`);
  if (named === undefined && !isGas) {
    return { ok: false, problem: { kind: "bad_set", set } };
  }
  // A value the limit does not take becomes `null`, which the schema refuses.
  const wire =
    named === undefined
      ? { gasReserve: gasReserveOf(chains, key.slice(gasReserveKey.length + 1), value) ?? null }
      : { [named.field]: wireOf[named.kind](value) ?? null };
  const parsed = limitChangesSchema.safeParse(wire);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, problem: { kind: "bad_value", key, value } };
}

/**
 * Reads each `key=value` as a change of the agent's limits, in the order given, a later one of the
 * same limit winning; gas reserves of several chains add up. The first set this cannot read stops
 * it: a key no limit has, or a value the limit does not take.
 */
export function limitChangesOf(chains: ChainRegistry, sets: readonly string[]): LimitSetOutcome {
  const changes: LimitChanges[] = [];
  for (const set of sets) {
    const change = changeOf(chains, set);
    if (!change.ok) {
      return change;
    }
    changes.push(change.value);
  }
  const merged = changes.reduce<LimitChanges>((all, change) => Object.assign(all, change), {});
  const gasReserve = changes.reduce<Readonly<Record<ChainRef, bigint>>>(
    (all, change) => Object.assign(all, change.gasReserve),
    {},
  );
  return {
    ok: true,
    value: Object.keys(gasReserve).length === 0 ? merged : { ...merged, gasReserve },
  };
}
