import {
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type LaunchOption,
  type LaunchOptionValue,
  type LaunchWordLimits,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";

/**
 * The settings of a Genius.fun launch (decision 0277): who receives the creator's share of every
 * trade's fee, and the address of the token's picture, a link the owner hosts (decision 0276).
 * Both must be given; nothing picks either for the owner.
 */
export const geniusfunLaunchOptions: readonly LaunchOption[] = [
  { name: "creatorFeeRecipient", type: "account" },
  { name: "pictureLink", type: "link" },
];

/**
 * The bytes the launch deployer takes for each word of a launch (`MetadataTooLong` beyond them,
 * verified source of `GeniusLaunchDeployer`): a name of 64, a symbol of 16, a description of 2,048
 * and each social link of 256.
 */
export const geniusfunWordLimits: LaunchWordLimits = {
  nameBytes: 64,
  symbolBytes: 16,
  descriptionBytes: 2_048,
  linkBytes: 256,
};

/** A Genius.fun launch's settings, as its create call writes them. */
export interface GeniusLaunchSettings {
  readonly creatorFeeRecipient: Address;
  /** The token's `logo`: the picture link, byte for byte. */
  readonly pictureLink: string;
}

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "geniusfun.bad_settings", message });
}

function recipientOf(value: LaunchOptionValue | undefined): Address {
  const account = accountRefSchema.safeParse(value);
  const address = account.success
    ? parseEvmAddress(accountRefParts(account.data).address)
    : undefined;
  if (address?.ok !== true) {
    throw refuse("The launch names no creator fee recipient on its chain.");
  }
  return address.value;
}

/**
 * A launch's settings, read from the values the host checked against
 * {@link geniusfunLaunchOptions}. A value missing or of another type throws
 * `geniusfun.bad_settings` before anything is read or built.
 */
export function geniusfunSettingsOf(
  options: Readonly<Record<string, LaunchOptionValue>>,
): GeniusLaunchSettings {
  const pictureLink = options["pictureLink"];
  if (typeof pictureLink !== "string") {
    throw refuse("The launch gives no picture link.");
  }
  return { creatorFeeRecipient: recipientOf(options["creatorFeeRecipient"]), pictureLink };
}
