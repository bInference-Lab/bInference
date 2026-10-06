import type { Signer } from "@binference/chain";
import type {
  BotUpdateSource,
  EngineStores,
  MarketData,
  ModelBilling,
  PriceSource,
} from "@binference/engine";
import type { SecretStore } from "@binference/platform";

/**
 * The parts whose adapter depends on the profile (ARCHITECTURE.md section 30). A composition root
 * builds one adapter for each: `cli` the self-hosted ones, the Cloud worker's entry file the Cloud
 * ones. Code outside the composition roots takes these ports and never learns the profile.
 */
export interface ProfileParts {
  /** Custody: signs for the agent wallets through Privy. */
  readonly custody: Signer;
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
}
