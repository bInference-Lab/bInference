import type { ProtocolClient } from "@binference/client";
import type { WalletView } from "@binference/protocol";
import type { WalletAddressFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { type AgentChoiceContext, chooseAgent } from "./agent-choice.js";
import { withEngine } from "./connect-engine.js";

/**
 * The wallet a command acts on: the one `--wallet` names among the agent's wallets, or the agent's
 * default wallet, its oldest one not archived. With none it prints why (`cli.no_wallet`, or the
 * engine's `wallet.not_found` for a wallet named) and answers `undefined`.
 */
async function chooseWallet(
  context: AgentChoiceContext,
  flags: WalletAddressFlags,
): Promise<WalletView | undefined> {
  const { client, output, signal } = context;
  const chosen = await chooseAgent(context, flags.agent);
  if (chosen === undefined) {
    return undefined;
  }
  const { items } = await client.call("wallet/list", { agent: chosen.agent }, { signal });
  const named = flags.wallet;
  const wallet =
    named === undefined
      ? items.find((item) => item.archivedAt === undefined)
      : items.find((item) => item.wallet === named);
  if (wallet !== undefined) {
    return wallet;
  }
  if (named === undefined) {
    output.fail({ code: "cli.no_wallet", key: "wallet.none", values: { agent: chosen.agent } });
  } else {
    output.refuse("wallet.not_found");
  }
  return undefined;
}

/**
 * Runs one call of a command on the wallet `--agent` or `--wallet` names, as {@link chooseWallet}
 * picks it. With none it prints why and exits 1 without calling `use`.
 */
export async function withWallet(
  run: CommandRun,
  flags: WalletAddressFlags,
  use: (wallet: WalletView, client: ProtocolClient, signal: AbortSignal) => Promise<ExitCode>,
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const wallet = await chooseWallet({ client, output, signal }, flags);
    return wallet === undefined ? 1 : use(wallet, client, signal);
  });
}
