import { identityVenuesDone } from "../identity/identity-venues-done.js";
import {
  createNoticeSettingsHandlers,
  type NoticeSettingsHandlers,
} from "../notices/notice-settings-handlers.js";
import type { PaperParts } from "../paper/paper-parts.js";
import { rescueReadsOf } from "../safety/rescue-ceilings.js";
import { createStakingHost } from "../venues/staking-host.js";
import {
  createWorkspaceHandlers,
  type WorkspaceHandlers,
} from "../workspace/workspace-handlers.js";
import { type AgentModeHandlers, createAgentModeHandlers } from "./agent-mode-handlers.js";
import { type BridgeQuoteHandlers, createBridgeQuoteHandlers } from "./bridge-quote-handlers.js";
import { type CeilingHandlers, createCeilingHandlers } from "./ceiling-handlers.js";
import type { EngineOptions } from "./create-engine.js";
import { installQuotasOf } from "./engine-quotas.js";
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
    LiveFactsHandlers,
    BridgeQuoteHandlers {}

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
    rescueReads: rescueReadsOf(options),
    venuesDone: identityVenuesDone({
      identities: stores.identities,
      registries: options.identity?.registries ?? [],
    }),
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

// The launch feed's records, which `market/scan` reads with `source: launches`.
function launchScanOf(options: EngineOptions) {
  const { stores, chains, host, clock } = options;
  return {
    launches: stores.launches,
    chains,
    isLaunchpad: (venue: string) => host.isLaunchpad(venue),
    clock,
  };
}

// The portfolio and market reads, over the paper parts and the launch feed's records.
function portfolioOf(options: EngineOptions, paper: PaperParts): PortfolioHandlers {
  const { stores, chains } = options;
  return createPortfolioHandlers({
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
    staking: createStakingHost({
      venues: options.stakingVenues ?? [],
      chains,
      clock: options.clock,
    }),
    unbondings: stores.unbondings,
    bridges: stores.bridges,
    clock: options.clock,
    ...(options.launchFeed === true ? { launchScan: launchScanOf(options) } : {}),
  });
}

// The agent's mode switch, which counts the install's live agents as one goes live (decision 0431).
function modesOf(options: EngineOptions) {
  const { stores } = options;
  return createAgentModeHandlers({
    agents: stores.agents,
    journal: stores.configJournal,
    wallets: options.wallets,
    custody: options.custody,
    chains: options.chains,
    host: options.host,
    install: stores.install,
    clock: options.clock,
    publish: options.publish,
    quotas: installQuotasOf(options),
  });
}

/**
 * Creates the settings handlers on the engine's options and its paper parts: the portfolio, the
 * agent's mode, its wallets and ceilings, its notice settings (decision 0185) and its workspace
 * files.
 */
export function settingsHandlers(options: EngineOptions, paper: PaperParts): SettingsHandlers {
  const { stores, chains } = options;
  const portfolio = portfolioOf(options, paper);
  const modes = modesOf(options);
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
    ...createBridgeQuoteHandlers({
      chains,
      destinations: options.destinations ?? [],
      bridges: options.bridges ?? [],
      custody: options.custody,
      wallets: options.wallets,
      install: stores.install,
      ceilings: options.ceilings,
      clock: options.clock,
      agents: stores.agents,
    }),
  };
}
