import type { AssetRef, ChainRef, Clock, Http, Secret } from "@binference/plugin-sdk";

/**
 * The owner's OKX API key, made in OKX's developer portal: the key, its secret and the passphrase
 * the owner chose. Each stays a `Secret`, revealed only to sign a request.
 */
export interface OkxKeys {
  readonly apiKey: Secret;
  readonly secretKey: Secret;
  readonly passphrase: Secret;
}

/** One chain the OKX venue trades on, as the composition root reads it from the registry. */
export interface OkxChain {
  readonly chain: ChainRef;
  /** The chain's own coin. OKX's API and router write it as `0xEeee…EEeE`. */
  readonly nativeAsset: AssetRef;
}

/** What the OKX venue is made from. */
export interface OkxOptions {
  /** Reaches OKX's DEX aggregator API. */
  readonly http: Http;
  /** Stamps each signed request; OKX refuses a stamp more than 30 s from its own clock. */
  readonly clock: Clock;
  readonly keys: OkxKeys;
  readonly chains: readonly OkxChain[];
}
