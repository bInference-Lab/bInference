import { type AssetRef, assetRefSchema, type ChainRef, chainRefSchema } from "@binference/chain";
import { type Bps, bpsSchema, type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, rowVersionSchema, shortTextSchema } from "../records/record-fields.js";

/** The native coin one wallet keeps on a chain for network fees, in base units. */
export interface GasReserve {
  readonly chain: ChainRef;
  readonly reserveBase: bigint;
}

/** An agent's limits (spec 2, `defaults.limits`): USD in micro-dollars, rates in basis points. */
export interface LimitsValues {
  readonly perTradeUsdMicros: bigint;
  readonly rollingDayUsdMicros: bigint;
  readonly slippageRegistryBps: Bps;
  readonly slippageOtherBps: Bps;
  readonly priceImpactBps: Bps;
  readonly taxBps: Bps;
  readonly liquidityFloorUsdMicros: bigint;
  /** The lowest health factor a lending move may leave, in basis points of 1: 1.5 is 15,000. */
  readonly minHealthFactorBp: number;
  readonly gasReserve: readonly GasReserve[];
  /** The venues the agent may use. */
  readonly venues: readonly string[];
  /** When not empty, the only tokens the agent may touch. */
  readonly allowTokens: readonly AssetRef[];
  readonly denyTokens: readonly AssetRef[];
  readonly modelBudgetUsdMicros: bigint;
  readonly cardTradeExpiryS: number;
  readonly cardOtherExpiryS: number;
  readonly requoteAfterS: number;
  readonly requoteToleranceBps: Bps;
  readonly orderExpiryDays: number;
  readonly copyPerBuyUsdMicros: bigint;
  readonly copyPerLeaderDayUsdMicros: bigint;
}

const usdMicros = z.bigint().nonnegative();
const seconds = z.int().positive();

const valuesShape = {
  perTradeUsdMicros: usdMicros,
  rollingDayUsdMicros: usdMicros,
  slippageRegistryBps: bpsSchema,
  slippageOtherBps: bpsSchema,
  priceImpactBps: bpsSchema,
  taxBps: bpsSchema,
  liquidityFloorUsdMicros: usdMicros,
  minHealthFactorBp: z.int().nonnegative(),
  gasReserve: z.array(
    z.strictObject({ chain: chainRefSchema, reserveBase: z.bigint().nonnegative() }),
  ),
  venues: z.array(shortTextSchema),
  allowTokens: z.array(assetRefSchema),
  denyTokens: z.array(assetRefSchema),
  modelBudgetUsdMicros: usdMicros,
  cardTradeExpiryS: seconds,
  cardOtherExpiryS: seconds,
  requoteAfterS: seconds,
  requoteToleranceBps: bpsSchema,
  orderExpiryDays: z.int().positive(),
  copyPerBuyUsdMicros: usdMicros,
  copyPerLeaderDayUsdMicros: usdMicros,
};

/** Parses an agent's limits. */
export const limitsValuesSchema: z.ZodType<LimitsValues> = z.strictObject(valuesShape);

/**
 * Looser limits that wait for their time (decision 0111): every limit as it will be from `atMs`,
 * which the store keeps as they were asked. Read the limits in effect through `limitsAt`.
 */
export interface PendingLimits {
  readonly values: LimitsValues;
  /** Epoch milliseconds from which they apply: 24 hours after the last looser one was asked. */
  readonly atMs: number;
}

const pendingSchema: z.ZodType<PendingLimits> = z.strictObject({
  values: limitsValuesSchema,
  atMs: epochMsSchema,
});

/**
 * An agent's limits as the store keeps them, with looser ones that wait, and the row version a
 * change names.
 */
export interface LimitsRecord extends LimitsValues {
  readonly agentId: Id<"agt">;
  readonly pending?: PendingLimits;
  readonly changedAtMs: number;
  readonly version: number;
}

/** Parses a limits record. */
export const limitsRecordSchema: z.ZodType<LimitsRecord> = z.strictObject({
  ...valuesShape,
  agentId: idSchema("agt"),
  pending: pendingSchema.exactOptional(),
  changedAtMs: epochMsSchema,
  version: rowVersionSchema,
});

/** New limits for an agent and looser ones that wait, under the version the changer read. */
export interface LimitsChange {
  readonly agentId: Id<"agt">;
  readonly limits: LimitsValues;
  /** Looser limits that wait; absent drops any that waited. */
  readonly pending?: PendingLimits;
  readonly atMs: number;
  readonly expectedVersion: number;
}

/** Parses a limits change. */
export const limitsChangeSchema: z.ZodType<LimitsChange> = z.strictObject({
  agentId: idSchema("agt"),
  limits: limitsValuesSchema,
  pending: pendingSchema.exactOptional(),
  atMs: epochMsSchema,
  expectedVersion: rowVersionSchema,
});
