import {
  accountRefParts,
  accountRefSchema,
  type AmountWire,
  amountSchema,
  type ChainRegistry,
} from "@binference/chain";
import type { StakingOptions, StakingVenue } from "@binference/chain/staking";
import { bpsSchema, type Clock, err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { callVenue, ownCopy } from "./call-venue.js";

/** What a staking venue's options are read with: the registry that names its coin, a clock. */
export interface StakeOptionsReadOptions {
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly timeoutMs: number;
}

/** {@link StakingOptions} as JSON carries them. */
interface StakingOptionsWire {
  readonly validators: readonly {
    readonly validator: string;
    readonly name: string;
    readonly commissionBps: number;
    readonly aprBps?: number;
    readonly jailed: boolean;
    readonly jailedUntilMs?: number;
  }[];
  readonly unbondingSeconds: number;
  readonly minStake: AmountWire;
  readonly readAtMs: number;
}

// A validator's name is its operator's own words: 1 to 64 characters with no control character.
const nameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+$/u);

const optionsSchema: z.ZodType<StakingOptions, StakingOptionsWire> = z.strictObject({
  validators: z
    .array(
      z.strictObject({
        validator: accountRefSchema,
        name: nameSchema,
        commissionBps: bpsSchema,
        aprBps: z.int().min(0).max(1_000_000).exactOptional(),
        jailed: z.boolean(),
        jailedUntilMs: z.int().nonnegative().exactOptional(),
      }),
    )
    .max(1_000),
  unbondingSeconds: z.int().nonnegative(),
  minStake: amountSchema,
  readAtMs: z.int().nonnegative(),
});

/**
 * The validators a staking venue lists now, with its unbonding time and least stake, copied: each
 * validator on the venue's chain, its name 1 to 64 printable characters, its yearly rate at most
 * 10,000%, and the least stake in the chain's coin. A venue that throws, runs out of time or
 * answers anything outside that is `venue_down`.
 */
export async function readStakeOptions(
  options: StakeOptionsReadOptions,
  venue: StakingVenue,
  signal: AbortSignal,
): Promise<Result<StakingOptions, "venue_down">> {
  const chain = options.chains.get(venue.chain);
  const read = await callVenue(async (inner) => venue.options({ signal: inner }), {
    clock: options.clock,
    signal,
    timeoutMs: options.timeoutMs,
  });
  if (!read.ok || !chain.ok) {
    return err("venue_down");
  }
  const copy = ownCopy(optionsSchema, read.value);
  const isOwn =
    copy !== undefined &&
    copy.minStake.asset === nativeAssetOf(chain.value) &&
    copy.validators.every(({ validator }) => accountRefParts(validator).chain === venue.chain);
  return isOwn ? ok(copy) : err("venue_down");
}
