import { chainRefSchema } from "@binference/chain";
import type { LimitChanges as WireChanges, LimitSettings, LimitsView } from "@binference/protocol";
import type { GasReserve, LimitsRecord, LimitsValues } from "../agents/limits-record.js";
import {
  type LimitChanges,
  type LimitName,
  type LimitsState,
  limitsChanged,
} from "../policy/limit-change.js";

/** Each limit by the name the protocol gives it. */
export const wireNames: { readonly [N in LimitName]: keyof LimitSettings } = {
  perTradeUsdMicros: "perTradeUsdMicros",
  rollingDayUsdMicros: "rollingDayUsdMicros",
  slippageRegistryBps: "slippageRegistryBps",
  slippageOtherBps: "slippageOtherBps",
  priceImpactBps: "priceImpactBps",
  taxBps: "taxBps",
  liquidityFloorUsdMicros: "liquidityFloorUsdMicros",
  minHealthFactorBp: "minHealthFactorBps",
  gasReserve: "gasReserve",
  venues: "venues",
  allowTokens: "allowTokens",
  denyTokens: "denyTokens",
  modelBudgetUsdMicros: "modelBudgetUsdMicros",
  cardTradeExpiryS: "cardTradeExpirySeconds",
  cardOtherExpiryS: "cardOtherExpirySeconds",
  requoteAfterS: "requoteAfterSeconds",
  requoteToleranceBps: "requoteToleranceBps",
  orderExpiryDays: "orderExpiryDays",
  copyPerBuyUsdMicros: "copyPerBuyUsdMicros",
  copyPerLeaderDayUsdMicros: "copyPerLeaderDayUsdMicros",
};

function settingsOf(values: LimitsValues): LimitSettings {
  const { minHealthFactorBp, gasReserve, cardTradeExpiryS, cardOtherExpiryS, requoteAfterS } =
    values;
  return {
    perTradeUsdMicros: values.perTradeUsdMicros,
    rollingDayUsdMicros: values.rollingDayUsdMicros,
    slippageRegistryBps: values.slippageRegistryBps,
    slippageOtherBps: values.slippageOtherBps,
    priceImpactBps: values.priceImpactBps,
    taxBps: values.taxBps,
    liquidityFloorUsdMicros: values.liquidityFloorUsdMicros,
    minHealthFactorBps: minHealthFactorBp,
    gasReserve: Object.fromEntries(
      gasReserve.map(({ chain, reserveBase }) => [chain, reserveBase]),
    ),
    venues: values.venues,
    allowTokens: values.allowTokens,
    denyTokens: values.denyTokens,
    modelBudgetUsdMicros: values.modelBudgetUsdMicros,
    cardTradeExpirySeconds: cardTradeExpiryS,
    cardOtherExpirySeconds: cardOtherExpiryS,
    requoteAfterSeconds: requoteAfterS,
    requoteToleranceBps: values.requoteToleranceBps,
    orderExpiryDays: values.orderExpiryDays,
    copyPerBuyUsdMicros: values.copyPerBuyUsdMicros,
    copyPerLeaderDayUsdMicros: values.copyPerLeaderDayUsdMicros,
  };
}

function withSetting(
  changes: WireChanges,
  settings: LimitSettings,
  key: keyof LimitSettings,
): WireChanges {
  return { ...changes, [key]: settings[key] };
}

/**
 * An agent's limits in effect as the protocol shows them, and the looser ones that wait: each
 * limit whose waiting value differs, at that value, with the time they all apply.
 */
export function limitsViewOf(record: LimitsRecord, state: LimitsState): LimitsView {
  const { pending } = state;
  const view = {
    ...settingsOf(state.values),
    agent: record.agentId,
    changedAt: record.changedAtMs,
  };
  if (pending === undefined) {
    return view;
  }
  const waiting = settingsOf(pending.values);
  const changes = limitsChanged(state.values, pending.values).reduce<WireChanges>(
    (sum, name) => withSetting(sum, waiting, wireNames[name]),
    {},
  );
  return { ...view, pending: { changes, effectiveAt: pending.atMs } };
}

// A changed gas reserve names only the chains it changes; every other chain keeps its reserve.
function reservesWith(
  current: readonly GasReserve[],
  changed: readonly GasReserve[],
): readonly GasReserve[] {
  const kept = current.filter((reserve) => !changed.some((item) => item.chain === reserve.chain));
  return [...kept, ...changed];
}

/** The chains a `limit/set` names in its gas reserve, with each reserve asked. */
export function reservesAsked(changes: WireChanges): readonly GasReserve[] {
  return Object.entries(changes.gasReserve ?? {}).map(
    ([chain, reserveBase]: readonly [string, bigint]) => ({
      chain: chainRefSchema.parse(chain),
      reserveBase,
    }),
  );
}

/** A `limit/set`'s changes by the engine's names, judged against the limits in effect. */
export function limitChangesOf(changes: WireChanges, current: LimitsValues): LimitChanges {
  const {
    minHealthFactorBps,
    gasReserve,
    cardTradeExpirySeconds,
    cardOtherExpirySeconds,
    requoteAfterSeconds,
    ...same
  } = changes;
  return {
    ...same,
    ...(minHealthFactorBps === undefined ? {} : { minHealthFactorBp: minHealthFactorBps }),
    ...(gasReserve === undefined
      ? {}
      : { gasReserve: reservesWith(current.gasReserve, reservesAsked(changes)) }),
    ...(cardTradeExpirySeconds === undefined ? {} : { cardTradeExpiryS: cardTradeExpirySeconds }),
    ...(cardOtherExpirySeconds === undefined ? {} : { cardOtherExpiryS: cardOtherExpirySeconds }),
    ...(requoteAfterSeconds === undefined ? {} : { requoteAfterS: requoteAfterSeconds }),
  };
}
