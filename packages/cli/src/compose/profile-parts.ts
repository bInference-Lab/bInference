import type { PriceSource, Signer } from "@binference/chain";
import type { SecretStore } from "@binference/core";
import type {
  BotUpdateSource,
  BreakerSource,
  EngineStores,
  MarketData,
  ModelBilling,
} from "@binference/engine";
import type {
  CeilingEditor,
  SignerRevoker,
  WalletExporter,
  WalletMaker,
} from "@binference/engine/install";
import type { MarketReads } from "@binference/engine/market";
import type { QuotaSource } from "@binference/engine/quotas";
import type { RiskSourceUse } from "@binference/engine/risk";
import type { ListedMcpSource } from "@binference/runtime";
import type { PluginListingRule } from "../plugins/plugin-listing-rule.js";

/**
 * The parts whose adapter depends on the profile (ARCHITECTURE.md section 30). A composition root
 * builds one adapter for each: `cli` the self-hosted ones, the Cloud worker's entry file the Cloud
 * ones. Code outside the composition roots takes these ports and never learns the profile.
 */
export interface ProfileParts {
  /** Custody: signs for the agent wallets through Privy. */
  readonly custody: Signer;
  /** Custody: changes whom each wallet's ceiling lets a send pay, with the owner key. */
  readonly ceilings: CeilingEditor;
  /** Custody: makes agent wallets, each under a ceiling of its own, with the owner key. */
  readonly walletMaker: WalletMaker;
  /**
   * Custody: exports a wallet's key sealed to the CLI's recipient key, with the owner key. Cloud
   * gives none: there the owner exports in Privy's own window.
   */
  readonly exporter?: WalletExporter;
  /**
   * Custody: removes a machine's agent key from every wallet, with the owner key. Cloud gives
   * none: there the owner removes the signer service in Privy's own window.
   */
  readonly revoker?: SignerRevoker;
  /** Telegram: the bot's inbound updates, by long polling or through a webhook relay. */
  readonly updates: BotUpdateSource;
  /** Models: who pays for model calls, and what each agent may still spend. */
  readonly billing: ModelBilling;
  /** Secrets at rest: the OS keychain and its fallbacks, or a hosted secret service. */
  readonly secrets: SecretStore;
  /** Store: the engine's store ports, on SQLite or Postgres. */
  readonly stores: EngineStores;
  /** Market data: the USD price of an asset now. */
  readonly prices: PriceSource;
  /** Market data: the blocks and prices the watchers stream. */
  readonly market: MarketData;
  /**
   * Market data: a token's pools and a chain's trending tokens, for `market/scan` and the agent's
   * market tools. Self-hosted reads DEX Screener itself; Cloud reads it once for every owner.
   */
  readonly marketReads: MarketReads;
  /**
   * Token risk: the risk data sources, each marked as one a token needs a report from or not.
   * Self-hosted asks GoPlus and honeypot.is; Cloud asks GoPlus alone, since honeypot.is's terms
   * forbid sharing its API.
   */
  readonly riskSources: readonly RiskSourceUse[];
  /**
   * MCP: the reviewed MCP listings each agent has on (decision 0428). Cloud reads the signed
   * catalog; self-hosted gives none, so no self-hosted agent gets a listed tool.
   */
  readonly listedMcp?: ListedMcpSource;
  /**
   * Quotas: what the install may hold and how fast its agents may work (decision 0431).
   * Self-hosted holds none (`noQuotas`); Cloud reads each user's numbers.
   */
  readonly quotas: QuotaSource;
  /**
   * The breaker: bInference's switch that holds every agent it hosts (decision 0439). Self-hosted
   * has none (`noBreaker`); Cloud reads the worker's copy of the breaker's row. The field is
   * required, so no composition root leaves an install out of its breaker by leaving it out.
   */
  readonly breaker: BreakerSource;
  /**
   * Plugins: whether a plugin needs a listing bInference signed (decision 0433). Self-hosted needs
   * none (`notRequired`); Cloud holds the listing keys and reads the catalog. The field is
   * required, so no composition root leaves installs open by leaving it out.
   */
  readonly pluginListing: PluginListingRule;
}

/**
 * The profile parts the engine runs on: custody with its ceilings, wallet maker, exporter and
 * signer revoker, stores, prices, risk sources, market reads, quotas and the breaker.
 */
export type EngineParts = Pick<
  ProfileParts,
  | "custody"
  | "ceilings"
  | "walletMaker"
  | "exporter"
  | "revoker"
  | "stores"
  | "prices"
  | "riskSources"
  | "marketReads"
  | "quotas"
  | "breaker"
>;
