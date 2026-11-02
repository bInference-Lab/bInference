import {
  type Amount,
  type AssetRef,
  amountSchema,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import type { BridgeTarget } from "../requests/intent-request.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { venueIdSchema } from "../values/plain-id.schema.js";
import { type AssetInfos, assetInfosSchema } from "../views/asset-info.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/**
 * The args of `bridge/quote`: what to send to another chain, from which wallet, and whom the
 * route is priced for; with no `to`, the rescue address where it may be paid (decision 0330).
 */
interface BridgeQuoteArgs {
  readonly agent: ProtocolId<"agent">;
  readonly wallet?: ProtocolId<"wallet">;
  readonly amount: Amount;
  readonly toChain: ChainRef;
  readonly to?: BridgeTarget;
}

/** One kind of fee a bridge keeps of the amount sent, in the token sent. */
interface BridgeFeeView {
  readonly kind: "bridge" | "relayer" | "gas";
  readonly amount: Amount;
}

/**
 * One bridge route's quote: what it sends, what it expects the recipient to get and the least the
 * deposit lets a fill pay, in the delivered token of `toChain`, which may differ from the token
 * sent; its fees, how long it expects to take, and how long the quote holds.
 */
interface BridgeRouteView {
  readonly venue: string;
  readonly toChain: ChainRef;
  readonly sentAsset: AssetRef;
  readonly deliveredAsset: AssetRef;
  readonly amountIn: Amount;
  readonly expectedOut: Amount;
  readonly minOut: Amount;
  readonly fees: readonly BridgeFeeView[];
  readonly etaSeconds: number;
  readonly quotedAt: number;
  readonly expiresAt: number;
}

/** What `bridge/quote` answers: each route that quoted, the best least output first. */
interface BridgeQuotes {
  readonly items: readonly BridgeRouteView[];
  readonly assets: AssetInfos;
}

/** The bridge read of protocol spec section 7.3. */
export interface BridgeOperationShapes {
  readonly "bridge/quote": { readonly args: BridgeQuoteArgs; readonly result: BridgeQuotes };
}

const routeViewSchema: z.ZodType<BridgeRouteView> = z.object({
  venue: venueIdSchema,
  toChain: chainRefSchema,
  sentAsset: assetRefSchema,
  deliveredAsset: assetRefSchema,
  amountIn: amountSchema,
  expectedOut: amountSchema,
  minOut: amountSchema,
  fees: z.array(z.object({ kind: z.enum(["bridge", "relayer", "gas"]), amount: amountSchema })),
  etaSeconds: z.int().nonnegative(),
  quotedAt: epochMsSchema,
  expiresAt: epochMsSchema,
});

/** The bridge operation, by name. */
export const bridgeOperations: OperationTable<BridgeOperationShapes> = {
  "bridge/quote": {
    ...readFlags,
    name: "bridge/quote",
    scope: "read",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      wallet: protocolIdSchema("wallet").exactOptional(),
      amount: amountSchema,
      toChain: chainRefSchema,
      to: z
        .union([
          z.strictObject({ entry: protocolIdSchema("addressBook") }),
          z.strictObject({ rescue: z.literal(true) }),
        ])
        .exactOptional(),
    }),
    result: z.object({ items: z.array(routeViewSchema).max(64), assets: assetInfosSchema }),
  },
};
