import { accountRefParts, type ChainRef } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import { operations, type WalletView } from "@binference/protocol";
import { z } from "zod";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import type { AgentFlags, WalletAddressFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { chooseAgent } from "./agent-choice.js";
import { withEngine } from "./connect-engine.js";

// A label is the owner's text from any surface: cut and made visible, as cards do.
const labelLength = 64;

// The chain's name when this binference serves it, such as BNB Smart Chain; else its id.
function chainName(chain: ChainRef): string {
  const registered = selfHostedChains().get(chain);
  return registered.ok ? registered.value.definition.name : chain;
}

function walletValues(wallet: WalletView) {
  const { chain, address } = accountRefParts(wallet.address);
  return {
    label: displayOutsideText(wallet.label, labelLength),
    wallet: wallet.wallet,
    agent: wallet.agent,
    chain: chainName(chain),
    address,
  };
}

/**
 * `binference wallet list [--agent <id>]`: the agent wallets through `wallet/list`, every agent's
 * when `--agent` is left out, oldest first, each with its label, its address and its chain, and
 * archived ones marked. With `--json` it prints the list as the operation answers it.
 */
export async function runWalletList(
  run: CommandRun,
  request: { readonly options: AgentFlags },
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const { agent } = request.options;
    const page = await client.call("wallet/list", agent === undefined ? {} : { agent }, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["wallet/list"].result, page)));
    output.say("wallet.count", { count: page.items.length });
    for (const wallet of page.items) {
      const archived = wallet.archivedAt === undefined ? "no" : "yes";
      output.item("wallet.item", { ...walletValues(wallet), archived });
    }
    return 0;
  });
}

/**
 * `binference wallet address [--agent <id>] [--wallet <id>]`: the address to fund the agent's
 * default wallet at, its oldest one not archived, or the wallet `--wallet` names. The address
 * stands on its own line, ready to copy. With `--json` it prints `{ agent, wallet, label, address }`.
 */
export async function runWalletAddress(
  run: CommandRun,
  request: { readonly options: WalletAddressFlags },
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const chosen = await chooseAgent({ client, output, signal }, request.options.agent);
    if (chosen === undefined) {
      return 1;
    }
    const { items } = await client.call("wallet/list", { agent: chosen.agent }, { signal });
    const named = request.options.wallet;
    const wallet =
      named === undefined
        ? items.find((item) => item.archivedAt === undefined)
        : items.find((item) => item.wallet === named);
    if (wallet === undefined) {
      if (named === undefined) {
        output.fail({ code: "cli.no_wallet", key: "wallet.none", values: { agent: chosen.agent } });
      } else {
        output.refuse("wallet.not_found");
      }
      return 1;
    }
    const { agent, label, address } = wallet;
    output.json({ agent, wallet: wallet.wallet, label, address });
    const values = walletValues(wallet);
    output.say("wallet.address", values);
    output.line(values.address);
    return 0;
  });
}
