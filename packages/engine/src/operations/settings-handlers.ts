import {
  createNoticeSettingsHandlers,
  type NoticeSettingsHandlers,
} from "../notices/notice-settings-handlers.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { type AgentModeHandlers, createAgentModeHandlers } from "./agent-mode-handlers.js";
import { type CeilingHandlers, createCeilingHandlers } from "./ceiling-handlers.js";
import type { EngineOptions } from "./create-engine.js";
import { createPortfolioHandlers, type PortfolioHandlers } from "./portfolio-handlers.js";
import { createWalletHandlers, type WalletHandlers } from "./wallet-handlers.js";

/** The handlers of an agent's settings: its portfolio, mode, wallets, ceilings and notices. */
export interface SettingsHandlers
  extends
    PortfolioHandlers,
    AgentModeHandlers,
    WalletHandlers,
    CeilingHandlers,
    NoticeSettingsHandlers {}

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

/**
 * Creates the settings handlers on the engine's options and its paper parts: the portfolio, the
 * agent's mode, its wallets and ceilings, and its notice settings (decision 0185).
 */
export function settingsHandlers(options: EngineOptions, paper: PaperParts): SettingsHandlers {
  const { stores, chains } = options;
  const portfolio = createPortfolioHandlers({
    marketReads: options.marketReads,
    agents: stores.agents,
    install: stores.install,
    portfolio: paper.portfolio,
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
    clock: options.clock,
    publish: options.publish,
  });
  const wallets = createWalletHandlers({
    agents: stores.agents,
    install: stores.install,
    custody: options.custody,
    ceilings: options.ceilings,
    maker: options.walletMaker,
    ...(options.exporter === undefined ? {} : { exporter: options.exporter }),
    ...(options.revoker === undefined ? {} : { revoker: options.revoker }),
    journal: stores.configJournal,
    chains,
    clock: options.clock,
    ids: options.ids,
    publish: options.publish,
  });
  const ceilings = createCeilingHandlers({
    agents: stores.agents,
    install: stores.install,
    ceilings: options.ceilings,
    journal: stores.configJournal,
    chains,
    clock: options.clock,
    publish: options.publish,
  });
  return { ...portfolio, ...modes, ...wallets, ...ceilings, ...noticeSettingsOf(options) };
}
