import type { ChainRef } from "@binference/chain";
import { bsc } from "@binference/chains";
import { isKyberswapClientId } from "@binference/kyberswap";
import { z } from "zod";
import { type SecretSource, secretSourceSchema } from "./secret-source.schema.js";
import { chainSchema, decimalSchema } from "./value-formats.schema.js";

/** Extra or replacement RPCs of one chain. */
export interface RpcConfig {
  readonly urls?: readonly string[];
  /** A paid RPC's key. */
  readonly key?: SecretSource;
  /**
   * The URL of the owner's RPC that answers `debug_traceTransaction`, read from a secret source
   * since a paid node's URL carries its key (decision 0108).
   */
  readonly tracer?: SecretSource;
  /**
   * The `wss:` URL of the owner's RPC that pushes new blocks, read from a secret source since a
   * paid node's URL carries its key (decision 0192). Without it the price watcher polls.
   */
  readonly ws?: SecretSource;
}

/** The chains the agent trades on, their RPCs, their private relays and their network fee caps. */
export interface ChainsConfig {
  readonly enabled: readonly ChainRef[];
  readonly rpc: Readonly<Record<ChainRef, RpcConfig>>;
  readonly relays: Readonly<Record<ChainRef, readonly string[]>>;
  /**
   * Each chain's network fee cap in gwei, as decimal text such as `"1"`: a higher fee per gas waits
   * for the owner's tap (decision 0102).
   */
  readonly maxFeePerGasGwei: Readonly<Record<ChainRef, string>>;
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
  /** The provider behind `search_web`; without one, the first of Brave and Tavily with a key. */
  readonly provider?: "brave" | "tavily";
  readonly keys: { readonly brave?: SecretSource; readonly tavily?: SecretSource };
  readonly xApiKey?: SecretSource;
}

// The relays this binference's chain files name; an https URL names a relay of the owner's own.
const listedRelays: ReadonlyMap<string, readonly string[]> = new Map([
  [bsc.id, bsc.relays.map(({ name }) => name)],
]);

// Each relay is one the chain lists by name, or an https URL, so a reload never hands the
// executor a relay it cannot reach (decision 0230).
function knownRelays(
  relays: Readonly<Record<string, readonly string[]>>,
  context: z.RefinementCtx,
): void {
  for (const [chain, entries] of Object.entries(relays)) {
    entries.forEach((entry, at) => {
      const isListed = listedRelays.get(chain)?.includes(entry) === true;
      if (!isListed && URL.parse(entry)?.protocol !== "https:") {
        const message = `${entry} is no relay ${chain} lists and no https URL.`;
        context.addIssue({ code: "custom", path: [chain, at], message, input: entry });
      }
    });
  }
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
          tracer: secretSourceSchema
            .exactOptional()
            .describe(
              "The URL of your RPC that answers debug_traceTransaction, such as a paid node's. " +
                "binference asks it what a trade received once the public RPCs dropped an old block.",
            ),
          ws: secretSourceSchema
            .exactOptional()
            .describe(
              "The wss:// URL of your RPC that pushes new blocks, such as a paid node's. The price " +
                "watcher follows each new block through it, and polls the RPCs while it is down.",
            ),
        }),
      )
      .prefault({})
      .meta({ description: "RPCs per chain.", keyName: "chain" }),
    relays: z
      .record(chainSchema, z.array(z.string().min(1)))
      .superRefine(knownRelays)
      .prefault({})
      .meta({
        description: "Private relays for sends, per chain.",
        keyName: "chain",
        defaultText: "the two fastest, by measurement",
      }),
    maxFeePerGasGwei: z
      .record(chainSchema, decimalSchema)
      .prefault({ [bsc.id]: "1" })
      .meta({
        description: "The network fee cap per chain, in gwei: a higher fee per gas asks the owner.",
        keyName: "chain",
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
      .refine(isKyberswapClientId, {
        message: "Use 1 to 64 letters, digits, dots, dashes or underscores.",
      })
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
    provider: z.enum(["brave", "tavily"]).exactOptional().meta({
      description: "The provider behind search_web.",
      defaultText: "the first of brave and tavily with a key",
    }),
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
