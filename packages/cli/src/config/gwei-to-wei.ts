import type { ChainRef } from "@binference/chain";
import { BinferenceError } from "@binference/core";

const gweiText = /^(\d+)(?:\.(\d{1,9}))?$/;
const weiPerGwei = 1_000_000_000n;

/**
 * A network fee cap in gwei, as config writes it, in wei: at most nine decimals. Any other text is
 * a `cli.bad_fee_cap` fault naming the chain.
 */
export function gweiToWei(text: string, chain: ChainRef): bigint {
  const [, whole, fraction = ""] = gweiText.exec(text) ?? [];
  if (whole === undefined) {
    throw new BinferenceError({
      code: "cli.bad_fee_cap",
      message: `The network fee cap of ${chain} is not gwei.`,
      details: { chain },
    });
  }
  return BigInt(whole) * weiPerGwei + BigInt(fraction.padEnd(9, "0"));
}
