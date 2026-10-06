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
import { type Bps, bpsSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { plainIdSchema, venueIdSchema } from "../values/plain-id.schema.js";
import { type TokenAmount, tokenAmountSchema } from "../values/token-amount.schema.js";

/** What every intent request carries. */
export interface RequestBase {
  readonly agent: ProtocolId<"agent">;
  /** The wallet that acts; absent: the agent's first wallet. */
  readonly wallet?: ProtocolId<"wallet">;
  /** The agent's words, shown on the card as "agent says", escaped. */
  readonly reason: string;
}

/** Swaps an amount of one asset for another. */
export interface SwapRequest extends RequestBase {
  readonly kind: "swap";
  readonly from: AssetRef;
  readonly to: AssetRef;
  readonly amount: TokenAmount;
  readonly maxSlippageBps?: Bps;
}

/** Buys a token with BNB or a stablecoin; the engine picks the curve or the pool. */
export interface BuyRequest extends RequestBase {
  readonly kind: "buy";
  readonly token: AssetRef;
  readonly spend: Amount;
  readonly maxSlippageBps?: Bps;
}

/** Sells a token, for `receive` or the engine's default asset. */
export interface SellRequest extends RequestBase {
  readonly kind: "sell";
  readonly token: AssetRef;
  readonly amount: TokenAmount;
  readonly receive?: AssetRef;
  readonly maxSlippageBps?: Bps;
}

/** Where a send goes: an address, a `.bnb` name, or an address book entry. */
export type SendTarget =
  | { readonly address: AccountRef }
  | { readonly name: string }
  | { readonly entry: ProtocolId<"addressBook"> };

/** Sends an amount to the rescue address or a saved address. */
export interface SendRequest extends RequestBase {
  readonly kind: "send";
  readonly amount: Amount;
  readonly to: SendTarget;
}

/** Sets a token's allowance for a spender back to zero. */
export interface RevokeApprovalRequest extends RequestBase {
  readonly kind: "revokeApproval";
  readonly token: AssetRef;
  readonly spender: AccountRef;
}

/** Supplies to, withdraws from, borrows from or repays a lending venue. */
export interface LendRequest extends RequestBase {
  readonly kind: "lend";
  readonly action: "supply" | "withdraw" | "borrow" | "repay";
  readonly venue: string;
  readonly amount: Amount;
}

/** Stakes, unstakes or claims on a staking venue. */
export interface StakeRequest extends RequestBase {
  readonly kind: "stake";
  readonly action: "stake" | "unstake" | "claim";
  readonly venue: string;
  readonly validator?: AccountRef;
  readonly amount?: Amount;
}

/** Where a bridge delivers: an address book entry, or the rescue address. */
export type BridgeTarget =
  | { readonly entry: ProtocolId<"addressBook"> }
  | { readonly rescue: true };

/** Moves an amount to another chain. */
export interface BridgeRequest extends RequestBase {
  readonly kind: "bridge";
  readonly amount: Amount;
  readonly toChain: ChainRef;
  readonly to: BridgeTarget;
}

/**
 * Places an order on a centralized exchange through its plugin. `size` and `price` are decimal
 * text in the market's own units, as the exchange writes them.
 */
export interface CexOrderRequest extends RequestBase {
  readonly kind: "cexOrder";
  readonly market: string;
  readonly side: "buy" | "sell";
  readonly type: "market" | "limit";
  readonly size: string;
  readonly price?: string;
}

/** Registers the agent in the chain's agent identity registry. */
export interface RegisterIdentityRequest extends RequestBase {
  readonly kind: "registerIdentity";
}

/** Web links a launched token shows. */
export interface TokenLinks {
  readonly website?: string;
  readonly x?: string;
  readonly telegram?: string;
}

/** Launches a token on a launchpad, with an optional first buy. */
export interface LaunchTokenRequest extends RequestBase {
  readonly kind: "launchToken";
  readonly venue: string;
  readonly name: string;
  readonly symbol: string;
  /** The id of an uploaded image. */
  readonly image: string;
  readonly description?: string;
  readonly links?: TokenLinks;
  readonly pairWith: AssetRef;
  readonly firstBuy?: Amount;
  /** The launchpad's own settings, such as a tax; its plugin checks them. */
  readonly venueOptions?: Readonly<Record<string, unknown>>;
}

/** What `intent/propose` asks for: one action, by `kind`. */
export type IntentRequest =
  | SwapRequest
  | BuyRequest
  | SellRequest
  | SendRequest
  | RevokeApprovalRequest
  | LendRequest
  | StakeRequest
  | BridgeRequest
  | CexOrderRequest
  | RegisterIdentityRequest
  | LaunchTokenRequest;

const requestBase = {
  agent: protocolIdSchema("agent"),
  wallet: protocolIdSchema("wallet").exactOptional(),
  reason: z.string().min(1),
};
const maxSlippageBps = bpsSchema.exactOptional();
const exchangeDecimal = z.string().regex(/^(?:0|[1-9]\d{0,30})(?:\.\d{1,18})?$/);
const link = z.url({ protocol: /^https$/ }).max(512);

const swapShape = {
  ...requestBase,
  kind: z.literal("swap"),
  from: assetRefSchema,
  to: assetRefSchema,
  amount: tokenAmountSchema,
  maxSlippageBps,
};

const buyShape = {
  ...requestBase,
  kind: z.literal("buy"),
  token: assetRefSchema,
  spend: amountSchema,
  maxSlippageBps,
};

const sellShape = {
  ...requestBase,
  kind: z.literal("sell"),
  token: assetRefSchema,
  amount: tokenAmountSchema,
  receive: assetRefSchema.exactOptional(),
  maxSlippageBps,
};

const sendShape = {
  ...requestBase,
  kind: z.literal("send"),
  amount: amountSchema,
  to: z.union([
    z.strictObject({ address: accountRefSchema }),
    z.strictObject({ name: z.string().min(1).max(255) }),
    z.strictObject({ entry: protocolIdSchema("addressBook") }),
  ]),
};

const revokeApprovalShape = {
  ...requestBase,
  kind: z.literal("revokeApproval"),
  token: assetRefSchema,
  spender: accountRefSchema,
};

const lendShape = {
  ...requestBase,
  kind: z.literal("lend"),
  action: z.enum(["supply", "withdraw", "borrow", "repay"]),
  venue: venueIdSchema,
  amount: amountSchema,
};

const stakeShape = {
  ...requestBase,
  kind: z.literal("stake"),
  action: z.enum(["stake", "unstake", "claim"]),
  venue: venueIdSchema,
  validator: accountRefSchema.exactOptional(),
  amount: amountSchema.exactOptional(),
};

const bridgeShape = {
  ...requestBase,
  kind: z.literal("bridge"),
  amount: amountSchema,
  toChain: chainRefSchema,
  to: z.union([
    z.strictObject({ entry: protocolIdSchema("addressBook") }),
    z.strictObject({ rescue: z.literal(true) }),
  ]),
};

const cexOrderShape = {
  ...requestBase,
  kind: z.literal("cexOrder"),
  market: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit"]),
  size: exchangeDecimal,
  price: exchangeDecimal.exactOptional(),
};

const registerIdentityShape = {
  ...requestBase,
  kind: z.literal("registerIdentity"),
};

const launchTokenShape = {
  ...requestBase,
  kind: z.literal("launchToken"),
  venue: venueIdSchema,
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(16),
  image: plainIdSchema,
  description: z.string().exactOptional(),
  links: z
    .strictObject({
      website: link.exactOptional(),
      x: link.exactOptional(),
      telegram: link.exactOptional(),
    })
    .exactOptional(),
  pairWith: assetRefSchema,
  firstBuy: amountSchema.exactOptional(),
  venueOptions: z.record(z.string(), z.unknown()).exactOptional(),
};

/** Parses a swap request, the args of `quote/get`. */
export const swapRequestSchema: z.ZodType<SwapRequest> = z.strictObject(swapShape);

/**
 * Parses the args of `intent/propose`. Unknown fields are refused. A valid request always becomes
 * an intent; policy and risk refusals are intent states, not parse errors.
 */
export const intentRequestSchema: z.ZodType<IntentRequest> = z.discriminatedUnion("kind", [
  z.strictObject(swapShape),
  z.strictObject(buyShape),
  z.strictObject(sellShape),
  z.strictObject(sendShape),
  z.strictObject(revokeApprovalShape),
  z.strictObject(lendShape),
  z.strictObject(stakeShape),
  z.strictObject(bridgeShape),
  z.strictObject(cexOrderShape),
  z.strictObject(registerIdentityShape),
  z.strictObject(launchTokenShape),
]);

/**
 * Parses a request as an intent view carries it. Fields a newer engine adds are dropped, so an
 * older client still reads the view.
 */
export const readIntentRequestSchema: z.ZodType<IntentRequest> = z.discriminatedUnion("kind", [
  z.object(swapShape),
  z.object(buyShape),
  z.object(sellShape),
  z.object(sendShape),
  z.object(revokeApprovalShape),
  z.object(lendShape),
  z.object(stakeShape),
  z.object(bridgeShape),
  z.object(cexOrderShape),
  z.object(registerIdentityShape),
  z.object(launchTokenShape),
]);
