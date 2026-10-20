import {
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type LaunchOption,
  type LaunchOptionValue,
  type LaunchSettingsRefusal,
  type LaunchWordLimits,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";

/**
 * The settings of a Brew launch (decision 0283), as the owner ruled on 2026-10-20:
 * - `poolFeeRecipient`, who receives the creator's share of the pool's fees: an address outside
 *   the install, since Brew's locker only credits it until that address claims it, a call
 *   binference never makes; given exactly when holder rewards are off.
 * - `holderRewards`, off unless asked: the creator's share buys the token back and burns it,
 *   through the holder distributor Brew makes for the token.
 * - `startMarketCap`, the market cap the token starts at, in base units of the pair: the owner
 *   may set it, else the quote works it out.
 * - `poolFee` and `liquidity`, each one word: a 1% pool, and the whole supply in one range from
 *   the starting price up.
 * - `startBasis`, `usdPrice` when the quote worked the start out as $5,000 at binference's USD
 *   price of the pair, so the card says so beside the amount; absent for any other start.
 * - `holderDistributor`, with holder rewards on, the token's holder distributor that receives the
 *   creator's share in place of a fee recipient: only the build works it out, from the token's
 *   address, and the card shows it whole.
 */
export const brewLaunchOptions: readonly LaunchOption[] = [
  { name: "poolFeeRecipient", type: "account", isOutsideOnly: true, isOptional: true },
  { name: "holderRewards", type: "flag", default: false },
  { name: "startMarketCap", type: "amount", isOptional: true },
  { name: "poolFee", type: "choice", choices: ["onePercent"], default: "onePercent" },
  { name: "liquidity", type: "choice", choices: ["oneRange"], default: "oneRange" },
  { name: "startBasis", type: "choice", choices: ["usdPrice"], isWorkedOut: true },
  { name: "holderDistributor", type: "account", isWorkedOut: true, isOutsideOnly: true },
];

/**
 * The bytes a Brew launch's words take: the factory's 64 for a name and 32 for a symbol
 * (BrewFactory's verified source), and a description and links short enough to leave room for a
 * small picture beside plain words in its 2,048-byte metadata address. Words that JSON escapes,
 * such as quotes and backslashes, take more there and can leave no room, which
 * `pictureBytesFor` then answers as 0.
 */
export const brewWordLimits: LaunchWordLimits = {
  nameBytes: 64,
  symbolBytes: 32,
  descriptionBytes: 600,
  linkBytes: 100,
};

/**
 * Whether a launch's settings go together (decision 0284): with holder rewards off it names a fee
 * recipient (`recipient_needed` if not) and no holder distributor; with them on, no fee recipient
 * (`recipient_unused` if it does).
 */
export function brewOptionsGoTogether(
  options: Readonly<Record<string, LaunchOptionValue>>,
): boolean | LaunchSettingsRefusal {
  const isHolders = options["holderRewards"] === true;
  const hasRecipient = options["poolFeeRecipient"] !== undefined;
  if (isHolders) {
    return hasRecipient ? "recipient_unused" : true;
  }
  return hasRecipient ? options["holderDistributor"] === undefined : "recipient_needed";
}

/** A Brew launch's settings, as its create call writes them. */
export interface BrewLaunchSettings {
  /** The creator fee recipient the owner named; absent with holder rewards on. */
  readonly feeRecipient?: Address;
  readonly holderRewards: boolean;
  /** The starting market cap, in base units of the pair. */
  readonly startMarketCap: bigint;
  /** The quote worked the start out from binference's USD price of the pair. */
  readonly isStartPriced: boolean;
}

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "brew.bad_settings", message });
}

function recipientOf(value: LaunchOptionValue | undefined): Address | undefined {
  if (value === undefined) {
    return undefined;
  }
  const account = accountRefSchema.safeParse(value);
  const address = account.success
    ? parseEvmAddress(accountRefParts(account.data).address)
    : undefined;
  if (address?.ok !== true) {
    throw refuse("The launch names a fee recipient that is no address on its chain.");
  }
  return address.value;
}

/**
 * A launch's settings, read from the values the host checked against {@link brewLaunchOptions},
 * the start the quote worked out among them. A start missing, a fee recipient beside holder
 * rewards or neither, or a value of another type throws `brew.bad_settings`.
 */
export function brewSettingsOf(
  options: Readonly<Record<string, LaunchOptionValue>>,
): BrewLaunchSettings {
  const start = options["startMarketCap"];
  const holderRewards = options["holderRewards"];
  if (typeof start !== "string" || !/^[1-9][0-9]*$/.test(start)) {
    throw refuse("The launch has no starting market cap.");
  }
  if (typeof holderRewards !== "boolean" || brewOptionsGoTogether(options) !== true) {
    throw refuse("A launch names a fee recipient exactly when holder rewards are off.");
  }
  const feeRecipient = recipientOf(options["poolFeeRecipient"]);
  return {
    ...(feeRecipient === undefined ? {} : { feeRecipient }),
    holderRewards,
    startMarketCap: BigInt(start),
    isStartPriced: options["startBasis"] === "usdPrice",
  };
}
