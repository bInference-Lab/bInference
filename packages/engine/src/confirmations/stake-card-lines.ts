import type { AccountRef } from "@binference/chain";
import { type Bps, bpsSchema } from "@binference/core";
import type { CardLine, CardValue } from "./card-line.js";

/** What a staking move's card shows under its action line (spec 4, section 3.9). */
export interface StakeDetails {
  /** What the validator keeps of its delegators' rewards, as the plan read it. */
  readonly commissionBps: Bps;
  /** The yearly rate of the validator's last day of rewards, when its venue gives one. */
  readonly aprBps?: number;
  /** An unstake's: the earliest its coin can be claimed, epoch milliseconds. */
  readonly readyAtMs?: number;
}

/** A validator's name and address, the parts of a staking line that name it. */
interface NamedValidator {
  readonly validator: AccountRef;
  readonly validatorName?: string;
  readonly details?: StakeDetails;
  readonly readyInDays?: number;
}

/**
 * A validator as a card names it (spec 4, section 3.9): `{moniker} ({address})`, or its address
 * alone when no name is known. Its operator sets the name, so surfaces escape it and cut it to 32
 * characters.
 */
export function validatorValue(move: NamedValidator): CardValue {
  const account: CardValue = { type: "account", account: move.validator };
  const { validatorName } = move;
  return validatorName === undefined
    ? account
    : {
        type: "line",
        line: {
          key: "card.value.validator",
          values: { moniker: { type: "text", text: validatorName }, address: account },
        },
      };
}

/**
 * The lines under a staking move's action line (spec 4, section 3.9): the validator with its
 * commission, its yearly rate when its venue gives one, and for an unstake when its coin can be
 * claimed, at the earliest, with the unbonding time in whole days.
 */
export function stakeDetailLines(move: NamedValidator): readonly CardLine[] {
  const { details } = move;
  if (details === undefined) {
    return [];
  }
  const { aprBps, readyAtMs } = details;
  // A rate above 100% a year is no share a percent line can show, so the card leaves it out.
  const bps = aprBps === undefined ? undefined : bpsSchema.safeParse(aprBps);
  const rate: readonly CardLine[] =
    bps?.success === true
      ? [{ key: "card.stake.rate", values: { rate: { type: "percent", bps: bps.data } } }]
      : [];
  const unbonding: readonly CardLine[] =
    readyAtMs === undefined
      ? []
      : [
          {
            key: "card.stake.unbonding",
            values: {
              readyAt: { type: "dateTime", atMs: readyAtMs },
              days: { type: "count", count: move.readyInDays ?? 0 },
            },
          },
        ];
  const validator: CardLine = {
    key: "card.stake.validator",
    values: {
      validator: validatorValue(move),
      commission: { type: "percent", bps: details.commissionBps },
    },
  };
  return [validator, ...rate, ...unbonding];
}
