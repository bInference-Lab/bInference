import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
} from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type ActivityItem, activityItemSchema } from "./activity-item.schema.js";
import { type AssetInfos, assetInfosSchema } from "./asset-info.schema.js";
import { type LaunchFilter, launchFilterSchema } from "./launch-filter.schema.js";
import { type LaunchView, launchViewSchema } from "./launch-view.schema.js";

/**
 * Fires once, on the first confirmed watcher price of `asset` at or past `price`, in micro-dollars
 * per whole token, in `direction`.
 */
export interface PriceCondition {
  readonly kind: "price";
  readonly asset: AssetRef;
  readonly direction: "above" | "below";
  readonly price: bigint;
}

/**
 * Fires on each trade of `account` the leader watcher reads that matches: of `side` and `asset`
 * when given, worth at least `minUsdMicros` when given.
 */
export interface WalletCondition {
  readonly kind: "wallet";
  readonly account: AccountRef;
  readonly side?: "buy" | "sell";
  readonly asset?: AssetRef;
  readonly minUsdMicros?: bigint;
}

/** Fires on each new launch that passes `filters`; an empty filter passes every launch. */
export interface LaunchCondition {
  readonly kind: "launch";
  readonly filters: LaunchFilter;
}

/**
 * What an alert watches (protocol spec, section 8.4). It notifies, may wake the agent, and sends
 * no transaction. A client that does not know a condition's kind shows the alert by its id and
 * state.
 */
export type AlertCondition = PriceCondition | WalletCondition | LaunchCondition;

/** Every state of an alert. */
export const alertStates = ["active", "fired", "deleted", "ended"] as const;

/**
 * An alert's state: `active` while it watches; `fired` once a price alert fired; `deleted` once a
 * client deleted it; `ended` once its `expiresAt` passed. Only an `active` alert fires. A client
 * that meets a state it does not know treats the alert as no longer active.
 */
export type AlertState = (typeof alertStates)[number];

/** An alert, how many times it fired and whether it wakes the agent. */
export interface AlertView {
  readonly alert: ProtocolId<"alert">;
  readonly agent: ProtocolId<"agent">;
  readonly condition: AlertCondition;
  readonly state: AlertState;
  /** Whether a fire starts a turn of the agent; the engine always sends it. */
  readonly wake?: boolean;
  /** How many times it fired; the engine always sends it. */
  readonly fires?: number;
  readonly createdAt: number;
  /** The last fire. */
  readonly firedAt?: number;
  readonly expiresAt?: number;
}

/** What fired an alert: a price, a wallet's trade, or a launch. */
export type AlertFire =
  | { readonly kind: "price"; readonly asset: AssetRef; readonly priceUsdMicros: bigint }
  | { readonly kind: "wallet"; readonly activity: ActivityItem }
  | { readonly kind: "launch"; readonly launch: LaunchView };

/**
 * One fire of an alert, the data of `alert/fired` (protocol spec, section 8.4). `woke` says whether
 * it started a turn; `wakeSkipped` counts the agent's wake-ups held back by the hourly limit since
 * its last wake-up. `assets` names each token it holds that the registry does not list.
 */
export interface AlertFired {
  readonly alert: ProtocolId<"alert">;
  readonly agent: ProtocolId<"agent">;
  readonly at: number;
  readonly fired: AlertFire;
  readonly woke: boolean;
  readonly wakeSkipped?: number;
  readonly assets: AssetInfos;
}

const priceShape = {
  kind: z.literal("price"),
  asset: assetRefSchema,
  direction: z.enum(["above", "below"]),
  price: decimalStringSchema,
};

const walletShape = {
  kind: z.literal("wallet"),
  account: accountRefSchema,
  side: z.enum(["buy", "sell"]).exactOptional(),
  asset: assetRefSchema.exactOptional(),
  minUsdMicros: decimalStringSchema.exactOptional(),
};

const launchShape = { kind: z.literal("launch"), filters: launchFilterSchema };

/** Parses the condition of `alert/create`. Unknown fields are refused. */
export const alertConditionSchema: z.ZodType<AlertCondition> = z.discriminatedUnion("kind", [
  z.strictObject(priceShape),
  z.strictObject(walletShape),
  z.strictObject(launchShape),
]);

const viewConditionSchema: z.ZodType<AlertCondition> = z.discriminatedUnion("kind", [
  z.object(priceShape),
  z.object(walletShape),
  z.object(launchShape),
]);

/** Parses an alert view. */
export const alertViewSchema: z.ZodType<AlertView> = z.object({
  alert: protocolIdSchema("alert"),
  agent: protocolIdSchema("agent"),
  condition: viewConditionSchema,
  state: z.enum(alertStates),
  wake: z.boolean().exactOptional(),
  fires: z.int().nonnegative().exactOptional(),
  createdAt: epochMsSchema,
  firedAt: epochMsSchema.exactOptional(),
  expiresAt: epochMsSchema.exactOptional(),
});

/** Parses what fired an alert. */
export const alertFireSchema: z.ZodType<AlertFire> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("price"),
    asset: assetRefSchema,
    priceUsdMicros: decimalStringSchema,
  }),
  z.object({ kind: z.literal("wallet"), activity: activityItemSchema }),
  z.object({ kind: z.literal("launch"), launch: launchViewSchema }),
]);

/** Parses the data of `alert/fired`. */
export const alertFiredSchema: z.ZodType<AlertFired> = z.object({
  alert: protocolIdSchema("alert"),
  agent: protocolIdSchema("agent"),
  at: epochMsSchema,
  fired: alertFireSchema,
  woke: z.boolean(),
  wakeSkipped: z.int().positive().exactOptional(),
  assets: assetInfosSchema,
});
