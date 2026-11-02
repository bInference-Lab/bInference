import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { ok } from "@binference/core";
import { drawPnlCard, type PositionFigures } from "@binference/engine";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import {
  type AgentView,
  type ArgsOf,
  type PnlCardView,
  type PortfolioView,
  protocolIdSchema,
} from "@binference/protocol";
import { assetsWith, refs } from "./card-fixtures.js";

type PnlArgs = ArgsOf<"portfolio/pnl">;

const whole = 10n ** 18n;
const atMs = Date.UTC(2026, 9, 10, 9, 30, 0);
const dayMs = 86_400_000;

/** The owner's agents: `main`, `scout`, and `old`, which is archived. */
export const agents: {
  readonly main: AgentView;
  readonly scout: AgentView;
  readonly old: AgentView;
} = {
  main: {
    agent: protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a1"),
    name: "main",
    mode: "live",
    locale: "en",
    createdAt: atMs,
    changedAt: atMs,
  },
  scout: {
    agent: protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a2"),
    name: "scout",
    mode: "paper",
    locale: "en",
    createdAt: atMs,
    changedAt: atMs,
  },
  old: {
    agent: protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-0000000000a3"),
    name: "old",
    mode: "paper",
    locale: "en",
    archivedAt: atMs,
    createdAt: atMs,
    changedAt: atMs,
  },
};

/** 2 PEPE held live: they cost $5.00 with $0.10 of fees and gas, and are worth $6.00. */
export const pepeOpen: PositionFigures = {
  asset: refs.pepe,
  isPaper: false,
  quantityBase: 2n * whole,
  costUsdMicros: 5_000_000n,
  valueUsdMicros: 6_000_000n,
  realizedUsdMicros: 0n,
  boughtUsdMicros: 5_000_000n,
  soldUsdMicros: 0n,
  venueFeeUsdMicros: 80_000n,
  networkFeeUsdMicros: 20_000n,
  sales: 0,
  openedAtMs: atMs - 2 * dayMs,
  changedAtMs: atMs - 2 * dayMs,
};

// USDT bought for $10.00 and sold for $9.50 net of its fees and gas, closed yesterday.
const usdtClosed: PositionFigures = {
  ...pepeOpen,
  asset: refs.usdt,
  quantityBase: 0n,
  costUsdMicros: 0n,
  valueUsdMicros: 0n,
  realizedUsdMicros: -500_000n,
  boughtUsdMicros: 10_000_000n,
  soldUsdMicros: 9_500_000n,
  sales: 1,
  changedAtMs: atMs - dayMs,
};

/** 1 BNB on paper with no price now. */
export const bnbPaper: PositionFigures = {
  ...pepeOpen,
  asset: refs.bnb,
  isPaper: true,
  quantityBase: whole,
  costUsdMicros: 600_000_000n,
  boughtUsdMicros: 600_000_000n,
  venueFeeUsdMicros: 0n,
  networkFeeUsdMicros: 0n,
};

const { valueUsdMicros: _noPrice, ...bnbUnpriced } = bnbPaper;

/** A position's card as the engine draws it for an agent. */
export function cardOf(figures: PositionFigures, agent: AgentView): PnlCardView {
  const info = assetsWith()[figures.asset];
  const facts = { figures, agentName: agent.name };
  return {
    asset: figures.asset,
    paper: figures.isPaper,
    closed: figures.quantityBase === 0n,
    lines: drawPnlCard(info === undefined ? facts : { ...facts, info }),
  };
}

/** Each agent's cards, as `portfolio/pnl` answers them with `cards`. */
export type CardsByAgent = Readonly<Record<string, readonly PnlCardView[]>>;

/** `main` holds PEPE and closed USDT live; `scout` holds BNB on paper with no price. */
export const ownerCards: CardsByAgent = {
  [agents.main.agent]: [cardOf(pepeOpen, agents.main), cardOf(usdtClosed, agents.main)],
  [agents.scout.agent]: [cardOf(bnbUnpriced, agents.scout)],
  [agents.old.agent]: [cardOf(pepeOpen, agents.old)],
};

const wallet = protocolIdSchema("wallet").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000b1");
const receipt = assetRefSchema.parse("fake:1/erc20:0x3333333333333333333333333333333333330001");
const bnb = (base: bigint) => ({ asset: refs.bnb, base });

/**
 * `main` staked one unit of a validator's receipt token live, worth 1.05 BNB or $630, waits for
 * half a BNB it unstaked and may claim a tenth now; staked 0.45 units on paper, worth 0.4725 BNB or
 * $283.50; and bridges 50 USDT to an account on another chain, late since the day began.
 */
export const stakingPortfolio: PortfolioView = {
  balances: [
    { wallet, amount: { asset: receipt, base: whole }, usdMicros: 630_000_000n, paper: false },
    {
      wallet,
      amount: { asset: receipt, base: (whole * 45n) / 100n },
      usdMicros: 283_500_000n,
      paper: true,
    },
  ],
  positions: [],
  totalUsdMicros: 0n,
  assets: assetsWith(),
  staking: [
    {
      wallet,
      venue: "stakehub",
      validator: accountRefSchema.parse("fake:1:0x2222222222222222222222222222222222220001"),
      staked: { asset: receipt, base: whole },
      stakedValue: bnb((whole * 105n) / 100n),
      unbonding: [{ amount: bnb(whole / 2n), readyAt: atMs + 7 * dayMs }],
      claimable: bnb(whole / 10n),
      paper: false,
    },
    {
      wallet,
      venue: "stakehub",
      validator: accountRefSchema.parse("fake:1:0x2222222222222222222222222222222222220001"),
      staked: { asset: receipt, base: (whole * 45n) / 100n },
      stakedValue: bnb((whole * 4725n) / 10_000n),
      unbonding: [],
      claimable: bnb(0n),
      paper: true,
    },
  ],
  inTransit: [
    {
      intent: protocolIdSchema("intent").parse("int_0190f1c2-3a4b-7c5d-8e6f-0000000000c1"),
      wallet,
      amount: { asset: refs.usdt, base: 50n * whole },
      usdMicros: 50_000_000n,
      toChain: chainRefSchema.parse("fake:2"),
      recipient: accountRefSchema.parse("fake:2:0x4444444444444444444444444444444444440001"),
      sentAt: atMs,
      late: true,
    },
  ],
};

/** Each agent's portfolio, as `portfolio/get` answers it for the agent. */
export type PortfolioByAgent = Readonly<Record<string, PortfolioView>>;

const noHoldings: PortfolioView = { balances: [], positions: [], totalUsdMicros: 0n, assets: {} };

/**
 * `agent/list`, `portfolio/pnl` and `portfolio/get` as the engine answers them for the owner's
 * agents, each with its cards and its portfolio, none unless given, and every call of
 * `portfolio/pnl` the bot made.
 */
export function pnlHandlers(
  byAgent: CardsByAgent,
  portfolios: PortfolioByAgent = {},
): Pick<OwnerChatHandlers, "agent/list" | "portfolio/pnl" | "portfolio/get"> & {
  readonly asked: () => readonly PnlArgs[];
} {
  const asked: PnlArgs[] = [];
  return {
    "agent/list": async () =>
      Promise.resolve(ok({ items: [agents.main, agents.scout, agents.old] })),
    "portfolio/pnl": async ({ args }) => {
      asked.push(args);
      return Promise.resolve(
        ok({
          positions: [],
          realizedUsdMicros: 0n,
          cards: byAgent[args.agent] ?? [],
          assets: assetsWith(),
        }),
      );
    },
    "portfolio/get": async ({ args }) =>
      Promise.resolve(ok(portfolios[args.agent ?? ""] ?? noHoldings)),
    asked: () => [...asked],
  };
}
