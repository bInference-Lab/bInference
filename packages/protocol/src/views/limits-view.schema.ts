import { type AssetRef, type ChainRef, assetRefSchema, chainRefSchema } from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { venueIdSchema } from "../values/plain-id.schema.js";

/** The caps and lists the engine checks for one agent, under the ceiling. */
export interface LimitSettings {
  readonly perTradeUsdMicros: bigint;
  readonly rollingDayUsdMicros: bigint;
  readonly slippageRegistryBps: Bps;
  readonly slippageOtherBps: Bps;
  readonly priceImpactBps: Bps;
  readonly taxBps: Bps;
  readonly liquidityFloorUsdMicros: bigint;
  /** The lowest health factor a borrow or withdraw may leave, in basis points: 1.5 is 15000. */
  readonly minHealthFactorBps: number;
  /** The base units of the native asset each chain's wallets keep for gas. */
  readonly gasReserve: Readonly<Record<ChainRef, bigint>>;
  /** The venues the agent may use. */
  readonly venues: readonly string[];
  /** When not empty, the only tokens the agent may trade. */
  readonly allowTokens: readonly AssetRef[];
  readonly denyTokens: readonly AssetRef[];
  readonly modelBudgetUsdMicros: bigint;
  readonly cardTradeExpirySeconds: number;
  readonly cardOtherExpirySeconds: number;
  readonly requoteAfterSeconds: number;
  readonly requoteToleranceBps: Bps;
  readonly orderExpiryDays: number;
  readonly copyPerBuyUsdMicros: bigint;
  readonly copyPerLeaderDayUsdMicros: bigint;
}

/** An agent's limits as `limit/get` answers them. */
export interface LimitsView extends LimitSettings {
  readonly agent: ProtocolId<"agent">;
  readonly changedAt: number;
}

/**
 * What `limit/set` changes; absent fields stay. Each change is braking or loosening on its own,
 * and the engine never moves a limit past the ceiling.
 */
export type LimitChanges = Partial<LimitSettings>;

const seconds = z.int().min(1);

// Every field optional, so `limit/set` takes it as is and the view requires it.
const settingsShape = {
  perTradeUsdMicros: decimalStringSchema.exactOptional(),
  rollingDayUsdMicros: decimalStringSchema.exactOptional(),
  slippageRegistryBps: bpsSchema.exactOptional(),
  slippageOtherBps: bpsSchema.exactOptional(),
  priceImpactBps: bpsSchema.exactOptional(),
  taxBps: bpsSchema.exactOptional(),
  liquidityFloorUsdMicros: decimalStringSchema.exactOptional(),
  minHealthFactorBps: z.int().min(10_000).exactOptional(),
  gasReserve: z.record(chainRefSchema, decimalStringSchema).exactOptional(),
  venues: z.array(venueIdSchema).exactOptional(),
  allowTokens: z.array(assetRefSchema).exactOptional(),
  denyTokens: z.array(assetRefSchema).exactOptional(),
  modelBudgetUsdMicros: decimalStringSchema.exactOptional(),
  cardTradeExpirySeconds: seconds.exactOptional(),
  cardOtherExpirySeconds: seconds.exactOptional(),
  requoteAfterSeconds: seconds.exactOptional(),
  requoteToleranceBps: bpsSchema.exactOptional(),
  orderExpiryDays: z.int().min(1).exactOptional(),
  copyPerBuyUsdMicros: decimalStringSchema.exactOptional(),
  copyPerLeaderDayUsdMicros: decimalStringSchema.exactOptional(),
};

/** Parses the changes of `limit/set`. Unknown fields are refused. */
export const limitChangesSchema: z.ZodType<LimitChanges> = z.strictObject(settingsShape);

/** Parses a limits view. */
export const limitsViewSchema: z.ZodType<LimitsView> = z
  .object({ ...settingsShape, agent: protocolIdSchema("agent"), changedAt: epochMsSchema })
  .required();
