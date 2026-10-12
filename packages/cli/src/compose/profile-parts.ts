import type { PriceSource, Signer } from "@binference/chain";
import type { SecretStore } from "@binference/core";
import type { BotUpdateSource, EngineStores, MarketData, ModelBilling } from "@binference/engine";
import type {
  CeilingEditor,
  SignerRevoker,
  WalletExporter,
  WalletMaker,
} from "@binference/engine/install";
import type { MarketReads } from "@binference/engine/market";
import type { RiskSourceUse } from "@binference/engine/risk";

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
}
