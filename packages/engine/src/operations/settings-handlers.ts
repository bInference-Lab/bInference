import {
  createNoticeSettingsHandlers,
  type NoticeSettingsHandlers,
} from "../notices/notice-settings-handlers.js";
import type { PaperParts } from "../paper/paper-parts.js";
import {
  createWorkspaceHandlers,
  type WorkspaceHandlers,
} from "../workspace/workspace-handlers.js";
import { type AgentModeHandlers, createAgentModeHandlers } from "./agent-mode-handlers.js";
import { type CeilingHandlers, createCeilingHandlers } from "./ceiling-handlers.js";
import type { EngineOptions } from "./create-engine.js";
import { createLiveFactsHandlers, type LiveFactsHandlers } from "./live-facts-handlers.js";
import { createPortfolioHandlers, type PortfolioHandlers } from "./portfolio-handlers.js";
import { createWalletHandlers, type WalletHandlers } from "./wallet-handlers.js";

/**
 * The handlers of an agent's settings: its portfolio, mode, wallets, ceilings, notices, workspace
 * files and live facts.
 */
export interface SettingsHandlers
  extends
    PortfolioHandlers,
    AgentModeHandlers,
    WalletHandlers,
    CeilingHandlers,
    NoticeSettingsHandlers,
    WorkspaceHandlers,
    LiveFactsHandlers {}

// The notice settings handlers, which read and journal through the agents and the journal.
function noticeSettingsOf(options: EngineOptions): NoticeSettingsHandlers {
  const { stores, clock, publish } = options;
  return createNoticeSettingsHandlers({
    agents: stores.agents,
    journal: stores.configJournal,
    clock,
    publish,
  });
}

// The ceiling handlers, which change custody's ceilings and journal each change.
function ceilingsOf(options: EngineOptions): CeilingHandlers {
  const { stores, chains } = options;
  return createCeilingHandlers({
    agents: stores.agents,
    install: stores.install,
    ceilings: options.ceilings,
    journal: stores.configJournal,
    chains,
    clock: options.clock,
    publish: options.publish,
  });
}

// What a turn's context reads: the workspace files, and the live facts, whose balances are what
// `portfolio/get` answers.
function contextHandlersOf(
  options: EngineOptions,
  portfolio: Pick<PortfolioHandlers, "portfolio/get">,
): WorkspaceHandlers & LiveFactsHandlers {
  const { stores } = options;
  return {
    ...createWorkspaceHandlers({ agents: stores.agents, workspace: options.workspace }),
    ...createLiveFactsHandlers({
      ...options,
      agents: stores.agents,
      orders: stores.orders,
      intents: stores.intents,
      portfolio: portfolio["portfolio/get"],
    }),
  };
}

/**
 * Creates the settings handlers on the engine's options and its paper parts: the portfolio, the
 * agent's mode, its wallets and ceilings, its notice settings (decision 0185) and its workspace
 * files.
 */
export function settingsHandlers(options: EngineOptions, paper: PaperParts): SettingsHandlers {
  const { stores, chains } = options;
  const portfolio = createPortfolioHandlers({
    marketReads: options.marketReads,
    agents: stores.agents,
    install: stores.install,
    portfolio: paper.portfolio,
    intents: stores.intents,
    positions: paper.positions,
    store: options.positions,
    wallets: options.wallets,
    prices: options.prices,
    chains,
  });
  const modes = createAgentModeHandlers({
    agents: stores.agents,
    journal: stores.configJournal,
    wallets: options.wallets,
    custody: options.custody,
    chains,
    host: options.host,
    install: options.stores.install,
    clock: options.clock,
    publish: options.publish,
  });
  const wallets = createWalletHandlers({
    agents: stores.agents,
    install: stores.install,
    custody: options.custody,
    ceilings: options.ceilings,
    maker: options.walletMaker,
    host: options.host,
    ...(options.exporter === undefined ? {} : { exporter: options.exporter }),
    ...(options.revoker === undefined ? {} : { revoker: options.revoker }),
    journal: stores.configJournal,
    chains,
    clock: options.clock,
    ids: options.ids,
    publish: options.publish,
  });
  const ceilings = ceilingsOf(options);
  return {
    ...portfolio,
    ...modes,
    ...wallets,
    ...ceilings,
    ...noticeSettingsOf(options),
    ...contextHandlersOf(options, portfolio),
  };
}
