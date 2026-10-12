import {
  type AccountRef,
  type Amount,
  type AssetRef,
  type ChainRef,
  accountRefSchema,
  amountSchema,
  assetRefSchema,
  chainRefSchema,
} from "@binference/chain";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type SwapRequest, swapRequestSchema } from "../requests/intent-request.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import type { Page } from "../values/page.schema.js";
import { signedUsdMicrosSchema } from "../values/signed-usd-micros.schema.js";
import {
  type AssetInfos,
  assetInfosSchema,
  type AssetView,
  assetViewSchema,
} from "../views/asset-info.schema.js";
import { type PortfolioView, portfolioViewSchema } from "../views/portfolio-view.schema.js";
import { type QuoteView, quoteViewSchema } from "../views/quote-view.schema.js";
import { type RiskView, riskViewSchema } from "../views/risk-view.schema.js";
import { readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** The args of `portfolio/get`: one agent, one wallet, or every agent when both are absent. */
interface PortfolioArgs {
  readonly agent?: ProtocolId<"agent">;
  readonly wallet?: ProtocolId<"wallet">;
}

/** The args of `portfolio/pnl`: one agent over a time range. */
interface PnlArgs {
  readonly agent: ProtocolId<"agent">;
  readonly from: number;
  readonly to: number;
}

/** One position's profit or loss in a range, at average cost; below zero is a loss. */
interface PositionPnl {
  readonly asset: AssetRef;
  readonly realizedUsdMicros: bigint;
  /** Absent when no price is known. */
  readonly unrealizedUsdMicros?: bigint;
}

/**
 * The answer of `portfolio/pnl`: the live P&L, and the paper P&L beside it, never added together
 * (decision 0137). Each total is absent where a position's is.
 */
interface PnlView {
  /** The live positions. */
  readonly positions: readonly PositionPnl[];
  readonly realizedUsdMicros: bigint;
  readonly unrealizedUsdMicros?: bigint;
  /** The paper positions; an engine before decision 0137 answers live ones only. */
  readonly paperPositions?: readonly PositionPnl[];
  readonly paperRealizedUsdMicros?: bigint;
  readonly paperUnrealizedUsdMicros?: bigint;
  readonly assets: AssetInfos;
}

/** The args of `portfolio/resetPaper`; absent balances: 1 BNB and 500 USDT. */
interface ResetPaperArgs {
  readonly agent: ProtocolId<"agent">;
  readonly balances?: readonly Amount[];
}

/** The args of an operation on one asset. */
interface AssetArgs {
  readonly asset: AssetRef;
}

/** What `asset/search` finds: the text to find on one chain. */
export interface AssetSearchTerms {
  readonly chain: ChainRef;
  /** A symbol, a name or a token's address. */
  readonly query: string;
}

/** The args of `asset/search`: the text to find on one chain, and whose held tokens count. */
interface AssetSearchArgs extends AssetSearchTerms {
  /** The agent whose wallets' held tokens count; every agent's when absent. */
  readonly agent?: ProtocolId<"agent">;
}

/** A token the registry does not list, found by its address. */
interface UnlistedAsset {
  /** The token's asset id in its family's canonical form. */
  readonly asset: AssetRef;
  /** A wallet of the agent, or of any agent, holds a position in it. */
  readonly held: boolean;
}

/**
 * The answer of `asset/search`: the registry's assets that match, every one on a single page, and
 * a pasted address the registry does not list.
 */
interface AssetSearchView extends Page<AssetView> {
  /** The address the query names, when the registry does not list it; it has no known symbol. */
  readonly unlisted?: readonly UnlistedAsset[];
  /** More than one asset matches: the caller asks the owner which one they mean. */
  readonly ambiguous?: true;
}

/** The answer of `name/resolve`. */
interface ResolvedName {
  readonly name: string;
  readonly address: AccountRef;
  readonly resolvedAt: number;
}

/** The market read operations of protocol spec section 7.3. */
export interface MarketOperationShapes {
  readonly "portfolio/get": { readonly args: PortfolioArgs; readonly result: PortfolioView };
  readonly "portfolio/pnl": { readonly args: PnlArgs; readonly result: PnlView };
  readonly "portfolio/resetPaper": {
    readonly args: ResetPaperArgs;
    readonly result: PortfolioView;
  };
  readonly "asset/get": { readonly args: AssetArgs; readonly result: AssetView };
  readonly "asset/search": { readonly args: AssetSearchArgs; readonly result: AssetSearchView };
  readonly "name/resolve": {
    readonly args: { readonly name: string };
    readonly result: ResolvedName;
  };
  readonly "quote/get": { readonly args: SwapRequest; readonly result: QuoteView };
  readonly "risk/check": { readonly args: AssetArgs; readonly result: RiskView };
}

const assetArgs = z.strictObject({ asset: assetRefSchema });
const searchFields = { chain: chainRefSchema, query: z.string().min(1).max(128) };

/**
 * Parses what `asset/search` finds without the agent whose held tokens count, which the agent
 * runtime fills for its agent. Unknown fields are refused.
 */
export const assetSearchTermsSchema: z.ZodType<AssetSearchTerms> = z.strictObject(searchFields);
const pnl = signedUsdMicrosSchema;
const positionPnl = z.object({
  asset: assetRefSchema,
  realizedUsdMicros: pnl,
  unrealizedUsdMicros: pnl.exactOptional(),
});

/** The market read operations, by name. */
export const marketOperations: OperationTable<MarketOperationShapes> = {
  "portfolio/get": {
    ...readFlags,
    name: "portfolio/get",
    scope: "read",
    args: z.strictObject({
      agent: protocolIdSchema("agent").exactOptional(),
      wallet: protocolIdSchema("wallet").exactOptional(),
    }),
    result: portfolioViewSchema,
  },
  "portfolio/pnl": {
    ...readFlags,
    name: "portfolio/pnl",
    scope: "read",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      from: epochMsSchema,
      to: epochMsSchema,
    }),
    result: z.object({
      positions: z.array(positionPnl),
      realizedUsdMicros: pnl,
      unrealizedUsdMicros: pnl.exactOptional(),
      paperPositions: z.array(positionPnl).exactOptional(),
      paperRealizedUsdMicros: pnl.exactOptional(),
      paperUnrealizedUsdMicros: pnl.exactOptional(),
      assets: assetInfosSchema,
    }),
  },
  "portfolio/resetPaper": {
    ...writeFlags,
    name: "portfolio/resetPaper",
    scope: "confirm",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      balances: z.array(amountSchema).min(1).exactOptional(),
    }),
    result: portfolioViewSchema,
  },
  "asset/get": {
    ...readFlags,
    name: "asset/get",
    scope: "read",
    args: assetArgs,
    result: assetViewSchema,
  },
  "asset/search": {
    ...readFlags,
    name: "asset/search",
    scope: "read",
    args: z.strictObject({ ...searchFields, agent: protocolIdSchema("agent").exactOptional() }),
    result: z.object({
      items: z.array(assetViewSchema),
      next: z.string().min(1).exactOptional(),
      unlisted: z.array(z.object({ asset: assetRefSchema, held: z.boolean() })).exactOptional(),
      ambiguous: z.literal(true).exactOptional(),
    }),
  },
  "name/resolve": {
    ...readFlags,
    name: "name/resolve",
    scope: "read",
    args: z.strictObject({ name: z.string().min(1).max(255) }),
    result: z.object({ name: z.string(), address: accountRefSchema, resolvedAt: epochMsSchema }),
  },
  "quote/get": {
    ...readFlags,
    name: "quote/get",
    scope: "read",
    args: swapRequestSchema,
    result: quoteViewSchema,
  },
  "risk/check": {
    ...readFlags,
    name: "risk/check",
    scope: "read",
    args: assetArgs,
    result: riskViewSchema,
  },
};
