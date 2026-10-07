import type { AccountRef } from "@binference/chain";
import { evmAccountRef, evmChainOf, parseEvmAddress } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import { ok } from "@binference/core";
import { type InitContext, type InitStep, refused } from "./init-context.js";

/** The owner's rescue address: as the ceiling names it, and as the engine keeps it. */
export interface RescueAddress {
  /** The EVM address in checksum case. */
  readonly address: string;
  /** The address on BNB Chain, as CAIP-10. */
  readonly account: AccountRef;
}

const zeroAddress = /^0x0{40}$/;

/** The rescue address in a text, or `undefined` for text that is no usable address. */
function rescueAddressOf(text: string): RescueAddress | undefined {
  const parsed = parseEvmAddress(text.trim());
  if (!parsed.ok || zeroAddress.test(parsed.value)) {
    return undefined;
  }
  return { address: parsed.value, account: evmAccountRef(evmChainOf(bsc), parsed.value) };
}

/**
 * The rescue address step (decision 0044): the owner's own wallet, where a rescue sends every
 * token and the BNB. Init refuses the zero address, any text that is no EVM address, and an
 * address in mixed case whose checksum is wrong.
 */
export async function takeRescueAddress(context: InitContext): Promise<InitStep<RescueAddress>> {
  const given = context.flags.rescue;
  if (given !== undefined) {
    const rescue = rescueAddressOf(given);
    return rescue === undefined
      ? refused("init.bad_rescue", "refused.badRescue", { flag: "--rescue" })
      : ok(rescue);
  }
  if (!context.isInteractive) {
    return refused("init.needs_flag", "refused.needsFlag", { flag: "--rescue" });
  }
  context.prompter.note(context.words("rescue.explain"), context.words("rescue.title"));
  const typed = await context.prompter.ask({
    id: "rescue",
    message: context.words("rescue.ask"),
    placeholder: "0x",
    check: (answer) =>
      rescueAddressOf(answer) === undefined ? context.words("rescue.invalid") : undefined,
  });
  const rescue = rescueAddressOf(typed);
  return rescue === undefined
    ? refused("init.bad_rescue", "refused.badRescue", { flag: "--rescue" })
    : ok(rescue);
}
