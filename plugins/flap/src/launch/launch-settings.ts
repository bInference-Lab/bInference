import {
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type LaunchOption,
  type LaunchOptionValue,
} from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import type { FlapLaunchSettings } from "./create-call.js";

// The Portal refuses a tax rate above 10%, or one from 0.01% to 0.99%, and a launch whose two rates
// are both 0 (read on BNB Smart Chain on 2026-10-20). A tax lasts at most 100 years.
const mostTaxBps = 1_000;
const leastTaxBps = 100;
const mostTaxDays = 36_500;

/**
 * The settings of a Flap launch (decision 0271): a tax token's buy and sell tax, who receives the
 * tax, the share of it that is burned, and how many days the tax lasts. Every one but the burned
 * share must be given; nothing picks a tax for the owner.
 */
export const flapLaunchOptions: readonly LaunchOption[] = [
  { name: "buyTaxBps", type: "bps", max: mostTaxBps },
  { name: "sellTaxBps", type: "bps", max: mostTaxBps },
  { name: "taxRecipient", type: "account" },
  { name: "burnShareBps", type: "bps", default: 0 },
  { name: "taxDays", type: "count", min: 1, max: mostTaxDays },
];

function refuse(message: string): BinferenceError {
  return new BinferenceError({ code: "flap.bad_settings", message });
}

function numberOf(options: Readonly<Record<string, LaunchOptionValue>>, name: string): number {
  const value = options[name];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw refuse(`The launch gives no whole number for ${name}.`);
  }
  return value;
}

function recipientOf(options: Readonly<Record<string, LaunchOptionValue>>): Address {
  const account = accountRefSchema.safeParse(options["taxRecipient"]);
  const address = account.success
    ? parseEvmAddress(accountRefParts(account.data).address)
    : undefined;
  if (address?.ok !== true) {
    throw refuse("The launch names no tax recipient on its chain.");
  }
  return address.value;
}

const isRate = (bps: number): boolean => bps === 0 || (bps >= leastTaxBps && bps <= mostTaxBps);

/**
 * A launch's settings, read from the values the host checked against {@link flapLaunchOptions}.
 * A tax rate the Portal refuses, or no tax on either side, throws `flap.bad_settings` before
 * anything is read or built.
 */
export function flapSettingsOf(
  options: Readonly<Record<string, LaunchOptionValue>>,
): FlapLaunchSettings {
  const settings = {
    buyTaxBps: numberOf(options, "buyTaxBps"),
    sellTaxBps: numberOf(options, "sellTaxBps"),
    taxRecipient: recipientOf(options),
    burnShareBps: numberOf(options, "burnShareBps"),
    taxDays: numberOf(options, "taxDays"),
  };
  const { buyTaxBps, sellTaxBps } = settings;
  if (!isRate(buyTaxBps) || !isRate(sellTaxBps) || buyTaxBps + sellTaxBps === 0) {
    throw refuse("Flap takes a tax of 0 or from 1% to 10% on each side, and some tax on one side.");
  }
  return settings;
}
