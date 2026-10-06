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
import { type Page, pageSchema } from "../values/page.schema.js";
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

/** The answer of `portfolio/pnl`. */
interface PnlView {
  readonly positions: readonly PositionPnl[];
  readonly realizedUsdMicros: bigint;
  readonly unrealizedUsdMicros?: bigint;
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
  readonly "asset/search": {
    readonly args: { readonly chain: ChainRef; readonly query: string };
    readonly result: Page<AssetView>;
  };
  readonly "name/resolve": {
    readonly args: { readonly name: string };
    readonly result: ResolvedName;
  };
  readonly "quote/get": { readonly args: SwapRequest; readonly result: QuoteView };
  readonly "risk/check": { readonly args: AssetArgs; readonly result: RiskView };
}

const assetArgs = z.strictObject({ asset: assetRefSchema });
const pnl = signedUsdMicrosSchema;

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
      positions: z.array(
        z.object({
          asset: assetRefSchema,
          realizedUsdMicros: pnl,
          unrealizedUsdMicros: pnl.exactOptional(),
        }),
      ),
      realizedUsdMicros: pnl,
      unrealizedUsdMicros: pnl.exactOptional(),
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
    args: z.strictObject({ chain: chainRefSchema, query: z.string().min(1).max(128) }),
    result: pageSchema(assetViewSchema),
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
