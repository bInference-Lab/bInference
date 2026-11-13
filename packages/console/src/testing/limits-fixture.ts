// One paper agent's limits as `limit/get` answers them, every limit set, and the same limits after
// a change, as `limit/set` and `limit/cancelPending` answer them.

const at = 1_800_000_000_000;
const day = 86_400_000;

/** The fixture's agent, and when a looser limit asked for at its time applies. */
export const limitsFixture = {
  agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  effectiveAt: at + day,
} as const;

const inEffect = {
  agent: limitsFixture.agent,
  changedAt: at,
  perTradeUsdMicros: 50_000_000n,
  rollingDayUsdMicros: 200_000_000n,
  slippageRegistryBps: 50,
  slippageOtherBps: 100,
  priceImpactBps: 300,
  taxBps: 1000,
  liquidityFloorUsdMicros: 10_000_000_000n,
  minHealthFactorBps: 15_000,
  gasReserve: {},
  venues: ["pancakeswap"],
  allowTokens: [],
  denyTokens: [],
  modelBudgetUsdMicros: 3_000_000n,
  cardTradeExpirySeconds: 60,
  cardOtherExpirySeconds: 600,
  requoteAfterSeconds: 30,
  requoteToleranceBps: 50,
  orderExpiryDays: 30,
  copyPerBuyUsdMicros: 20_000_000n,
  copyPerLeaderDayUsdMicros: 100_000_000n,
};

/** `agent/list` with the fixture's agent, main, on paper. */
export const limitsAgents = {
  items: [{ agent: limitsFixture.agent, name: "main", mode: "paper" }],
};

/** The fixture's limits in effect, with `more` in place of some, such as one that waits. */
export function limitsWith(more: object = {}): object {
  return { ...inEffect, ...more };
}

/** The 24-hour cap at $400, waiting a day from the fixture's time. */
export const higherDayCap = {
  pending: {
    changes: { rollingDayUsdMicros: 400_000_000n },
    effectiveAt: limitsFixture.effectiveAt,
  },
};
