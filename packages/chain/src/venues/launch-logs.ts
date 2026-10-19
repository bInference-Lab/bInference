import type { Bps } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import type { AssetRef } from "../caip/asset-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { ReadAnswer, ReadCall } from "./price-read.js";

/**
 * One log the launch feed read, in its chain family's own encoding: an EVM log's topics and data
 * as hex. Any contract may write any event, so a launchpad believes a log only from a contract it
 * knows, such as one of its registry contracts or the curve a launch of its own named.
 */
export interface LaunchLog {
  /** The contract that wrote the log. */
  readonly emitter: AccountRef;
  /** Its topics; the first names the event. */
  readonly topics: readonly string[];
  readonly data: string;
  /** Its index among its block's logs. */
  readonly index: number;
}

/** What the launch feed asks a launchpad: the launches and curve changes in one transaction. */
export interface LaunchLogsRequest {
  readonly chain: ChainRef;
  /** The launchpad's declared contracts on the chain, by their names in the registry. */
  readonly contracts: Readonly<Record<string, AccountRef>>;
  /** The transaction's logs the feed read for the launchpads, in log order. */
  readonly logs: readonly LaunchLog[];
}

/** What a launch's reads tell beyond its logs, each part only when they tell it. */
export interface LaunchFacts {
  readonly symbol?: string;
  readonly name?: string;
  readonly taxBps?: Bps;
  readonly snipeTaxBps?: Bps;
  readonly curveProgressBps?: Bps;
  readonly graduated?: boolean;
}

/**
 * The read calls that complete a launch, asked together at the latest block, and the pure step
 * that turns their answers, in their order, into facts. An answer that failed or falls outside its
 * shape leaves its fact out, never a throw.
 */
export interface LaunchCompletion {
  readonly calls: readonly ReadCall[];
  readonly facts: (answers: readonly ReadAnswer[]) => LaunchFacts;
}

/** A token a launchpad created, as its launch transaction's logs tell it. */
export interface FoundLaunch extends LaunchFacts {
  /** The token, on the request's chain. */
  readonly token: AssetRef;
  /** The wallet that launched it. */
  readonly creator: AccountRef;
  /** What its curve trades it against: a token, or the chain's coin. */
  readonly quoteAsset: AssetRef;
  /** The token's decimals, when the launchpad makes every token with the same. */
  readonly decimals?: number;
  readonly graduated: boolean;
  /** The wallets the launch exempted or that bought in its own transaction, each once. */
  readonly insiders: readonly AccountRef[];
  /** The index of its create event's log. */
  readonly index: number;
  /** What the logs leave out, read at the latest block; left out, nothing. */
  readonly complete?: LaunchCompletion;
}

/** A launch's curve as a later log tells it: how far it went, or that it graduated. */
export interface LaunchChange {
  readonly token: AssetRef;
  readonly curveProgressBps?: Bps;
  readonly graduated?: boolean;
  /** The index of the log that told it. */
  readonly index: number;
}

/** The launches and curve changes one transaction's logs tell, each in log order. */
export interface LaunchesFound {
  readonly launches: readonly FoundLaunch[];
  readonly changes: readonly LaunchChange[];
}
