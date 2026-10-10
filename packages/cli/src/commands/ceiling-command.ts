import { accountRefParts, type ChainRef } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import { type CeilingView, operations } from "@binference/protocol";
import { z } from "zod";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import type { WalletAddressFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { chainName } from "./chain-name.js";
import { withEngine } from "./connect-engine.js";
import { chooseWallet } from "./wallet-choice.js";

// A label is the owner's text from any surface: cut and made visible, as cards do.
const labelLength = 64;

// The cap in the native coin of the ceiling's first chain when this binference serves it, such as
// 1 BNB; else in base units.
function printCap(run: CommandRun, ceiling: CeilingView): void {
  const [chain] = ceiling.chains;
  const served = chain === undefined ? undefined : selfHostedChains().get(chain);
  if (served?.ok === true) {
    const { decimals, symbol } = served.value.definition.nativeAsset;
    const amount = run.formatter.tokenAmount(ceiling.perTxNative, decimals);
    run.output.say("ceiling.cap", { amount, symbol });
    return;
  }
  run.output.say("ceiling.capBase", { amount: String(ceiling.perTxNative) });
}

function printRecipients(run: CommandRun, ceiling: CeilingView): void {
  run.output.say("ceiling.recipients", { count: ceiling.recipients.length });
  for (const account of ceiling.recipients) {
    const { chain, address } = accountRefParts(account);
    run.output.item("ceiling.recipient", { address, chain: chainName(chain) });
  }
}

function namesOf(chains: readonly ChainRef[]): string {
  return chains.map(chainName).join(", ");
}

/**
 * `binference ceiling [--agent <id>] [--wallet <id>]`: the ceiling of the agent's default wallet,
 * or of the wallet `--wallet` names, as custody holds it now, through `ceiling/get`: the chains it
 * enables, the venues a call may reach, the most native coin one contract call may carry, and
 * every address a send may pay. Only the owner key changes a ceiling. With `--json` it prints the
 * ceiling as the operation answers it.
 */
export async function runCeiling(
  run: CommandRun,
  request: { readonly options: WalletAddressFlags },
): Promise<ExitCode> {
  const { host, output, formatter } = run;
  return withEngine(host, output, async (client, signal) => {
    const wallet = await chooseWallet({ client, output, signal }, request.options);
    if (wallet === undefined) {
      return 1;
    }
    const ceiling = await client.call("ceiling/get", { wallet: wallet.wallet }, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["ceiling/get"].result, ceiling)));
    output.say("ceiling.heading", {
      label: displayOutsideText(wallet.label, labelLength),
      wallet: wallet.wallet,
      readAt: formatter.dateTime(ceiling.readAt),
    });
    output.item("ceiling.chains", { chains: namesOf(ceiling.chains) });
    output.item("ceiling.venues", {
      count: ceiling.venues.length,
      venues: ceiling.venues.join(", "),
    });
    printCap(run, ceiling);
    printRecipients(run, ceiling);
    return 0;
  });
}
