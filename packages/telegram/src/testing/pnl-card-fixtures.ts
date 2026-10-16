import { ok } from "@binference/core";
import { drawPnlCard, type PositionFigures } from "@binference/engine";
import type { OwnerChatHandlers } from "@binference/engine/surfaces";
import {
  type AgentView,
  type ArgsOf,
  type PnlCardView,
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

/**
 * `agent/list` and `portfolio/pnl` as the engine answers them for the owner's agents, each with
 * its cards, and every call of `portfolio/pnl` the bot made.
 */
export function pnlHandlers(byAgent: CardsByAgent): Pick<
  OwnerChatHandlers,
  "agent/list" | "portfolio/pnl"
> & {
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
    asked: () => [...asked],
  };
}
