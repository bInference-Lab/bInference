import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  amountSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { venueIdSchema } from "../values/plain-id.schema.js";
import { type AssetInfos, assetInfosSchema } from "../views/asset-info.schema.js";
import { type PortfolioView, stakingPositionViewSchema } from "../views/portfolio-view.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/** The args of `staking/options`: the chain, the agent whose venues and stakes count, a venue. */
interface StakingOptionsArgs {
  readonly chain: ChainRef;
  readonly agent?: ProtocolId<"agent">;
  /** A staking venue's id, such as StakeHub's; every venue on the chain when absent. */
  readonly venue?: string;
}

/**
 * A validator a staking venue lists now, with the venue's unbonding time and least stake. `name`
 * is the validator's own moniker, set by its operator: outside content that a client escapes.
 */
interface StakingOptionView {
  readonly venue: string;
  readonly validator: AccountRef;
  readonly name: string;
  readonly commissionBps: number;
  /** Absent when the venue gives none. */
  readonly aprBps?: number;
  readonly jailed: boolean;
  readonly unbondingSeconds: number;
  readonly minAmount?: Amount;
}

/** What `staking/options` answers: the venues' validators, and the agent's stakes when it names one. */
interface StakingOptions {
  readonly items: readonly StakingOptionView[];
  readonly positions?: PortfolioView["staking"];
  readonly assets: AssetInfos;
}

/** The staking read of protocol spec section 7.3. */
export interface StakingOperationShapes {
  readonly "staking/options": {
    readonly args: StakingOptionsArgs;
    readonly result: StakingOptions;
  };
}

const stakingOptionViewSchema: z.ZodType<StakingOptionView> = z.object({
  venue: z.string().min(1).max(32),
  validator: accountRefSchema,
  name: z.string().min(1).max(64),
  commissionBps: z.int().min(0).max(10_000),
  aprBps: z.int().min(0).exactOptional(),
  jailed: z.boolean(),
  unbondingSeconds: z.int().nonnegative(),
  minAmount: amountSchema.exactOptional(),
});

/** The staking operation, by name. */
export const stakingOperations: OperationTable<StakingOperationShapes> = {
  "staking/options": {
    ...readFlags,
    name: "staking/options",
    scope: "read",
    args: z.strictObject({
      chain: chainRefSchema,
      agent: protocolIdSchema("agent").exactOptional(),
      venue: venueIdSchema.exactOptional(),
    }),
    result: z.object({
      items: z.array(stakingOptionViewSchema).max(1_000),
      positions: z.array(stakingPositionViewSchema).exactOptional(),
      assets: assetInfosSchema,
    }),
  },
};
