import { accountRefParts } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import { operations, type WalletView } from "@binference/protocol";
import { z } from "zod";
import type { AgentFlags, LabelFlags, WalletAddressFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { chooseAgentFirst } from "./agent-choice.js";
import { chainName } from "./chain-name.js";
import { withEngine } from "./connect-engine.js";
import { withOwnerKey } from "./owner-key-prompt.js";
import { chooseWallet } from "./wallet-choice.js";

// A label is the owner's text from any surface: cut and made visible, as cards do.
const labelLength = 64;

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
    const wallet = await chooseWallet({ client, output, signal }, request.options);
    if (wallet === undefined) {
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

/**
 * `binference wallet create --label <label> [--agent <id>]`: makes a new agent wallet through
 * `wallet/create` over IPC, with the owner key the person types unseen (decision 0130). Custody
 * makes it under a ceiling of its own, which lets it trade on the agent's venues and send only to
 * the rescue address and the saved addresses; the command shows the address to fund it at, on its
 * own line. With `--json` it prints the wallet as the operation answers it.
 */
export async function runWalletCreate(
  run: CommandRun,
  request: { readonly options: LabelFlags },
): Promise<ExitCode> {
  const { options } = request;
  const chosen = await chooseAgentFirst(run, options.agent);
  if (!chosen.ok) {
    return chosen.code;
  }
  const agent = chosen.value;
  const made = await withOwnerKey(run, options, {
    command: "wallet create",
    call: async (client, ownerKey, signal) =>
      client.call("wallet/create", { agent, label: options.label, ownerKey }, { signal }),
  });
  if (!made.ok) {
    return made.code;
  }
  run.output.json(jsonValueSchema.parse(z.encode(operations["wallet/create"].result, made.value)));
  const values = walletValues(made.value);
  run.output.say("wallet.created", values);
  run.output.line(values.address);
  return 0;
}
