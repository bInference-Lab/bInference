import type { ChainRef } from "@binference/chain";
import { bsc } from "@binference/chains";
import { z } from "zod";
import { type SecretSource, secretSourceSchema } from "./secret-source.schema.js";
import { chainSchema } from "./value-formats.schema.js";

/** Extra or replacement RPCs of one chain. */
export interface RpcConfig {
  readonly urls?: readonly string[];
  /** A paid RPC's key. */
  readonly key?: SecretSource;
}

/** The chains the agent trades on, their RPCs and their private relays. */
export interface ChainsConfig {
  readonly enabled: readonly ChainRef[];
  readonly rpc: Readonly<Record<ChainRef, RpcConfig>>;
  readonly relays: Readonly<Record<ChainRef, readonly string[]>>;
}

/** OKX's three secrets. */
export interface OkxKeysConfig {
  readonly apiKey: SecretSource;
  readonly secret: SecretSource;
  readonly passphrase: SecretSource;
}

/** Keys that add routing venues. */
export interface VenueKeysConfig {
  readonly okx?: OkxKeysConfig;
  readonly oneinch?: SecretSource;
  readonly zerox?: SecretSource;
}

/** The routing venues' keys and ids. */
export interface VenuesConfig {
  readonly keys: VenueKeysConfig;
  readonly kyberClientId: string;
}

/** The risk data cache. */
export interface RiskConfig {
  readonly cacheTtlSec: number;
}

/** The web search provider and its keys. */
export interface SearchConfig {
  readonly provider: "duckduckgo" | "brave" | "tavily";
  readonly keys: { readonly brave?: SecretSource; readonly tavily?: SecretSource };
  readonly xApiKey?: SecretSource;
}

/** Parses `chains`. */
export const chainsSchema: z.ZodType<ChainsConfig> = z
  .strictObject({
    enabled: z.array(chainSchema).prefault([bsc.id]).describe("Chains the agent trades on."),
    rpc: z
      .record(
        chainSchema,
        z.strictObject({
          urls: z
            .array(z.url())
            .exactOptional()
            .meta({ description: "Extra or replacement RPCs.", defaultText: "the public RPCs" }),
          key: secretSourceSchema.exactOptional().describe("A paid RPC's key."),
        }),
      )
      .prefault({})
      .meta({ description: "RPCs per chain.", keyName: "chain" }),
    relays: z
      .record(chainSchema, z.array(z.string().min(1)))
      .prefault({})
      .meta({
        description: "Private relays for sends, per chain.",
        keyName: "chain",
        defaultText: "the two fastest, by measurement",
      }),
  })
  .prefault({})
  .describe("Chains.");

/** Parses `venues`. */
export const venuesSchema: z.ZodType<VenuesConfig> = z
  .strictObject({
    keys: z
      .strictObject({
        okx: z
          .strictObject({
            apiKey: secretSourceSchema.describe("OKX's API key."),
            secret: secretSourceSchema.describe("OKX's secret."),
            passphrase: secretSourceSchema.describe("OKX's passphrase."),
          })
          .exactOptional()
          .describe("Adds OKX routing."),
        oneinch: secretSourceSchema.exactOptional().describe("Adds 1inch routing."),
        zerox: secretSourceSchema.exactOptional().describe("Adds 0x routing."),
      })
      .prefault({})
      .describe("Keys that add routing venues."),
    kyberClientId: z
      .string()
      .min(1)
      .prefault("binference")
      .describe("The client id sent to KyberSwap."),
  })
  .prefault({})
  .describe("Routing venues.");

/** Parses `risk`. */
export const riskSchema: z.ZodType<RiskConfig> = z
  .strictObject({
    cacheTtlSec: z
      .int()
      .positive()
      .prefault(600)
      .describe("How long risk answers are kept, in seconds."),
  })
  .prefault({})
  .describe("Risk data.");

/** Parses `search`. */
export const searchSchema: z.ZodType<SearchConfig> = z
  .strictObject({
    provider: z
      .enum(["duckduckgo", "brave", "tavily"])
      .prefault("duckduckgo")
      .describe("The provider behind search_web."),
    keys: z
      .strictObject({
        brave: secretSourceSchema.exactOptional().describe("Brave Search's key."),
        tavily: secretSourceSchema.exactOptional().describe("Tavily's key."),
      })
      .prefault({})
      .describe("Search provider keys."),
    xApiKey: secretSourceSchema.exactOptional().describe("Turns search_x on."),
  })
  .prefault({})
  .describe("Web search.");
