import type { WalletView } from "@binference/protocol";
import type { WalletAddressFlags } from "../program/cli-flags.schema.js";
import { type AgentChoiceContext, chooseAgent } from "./agent-choice.js";

/**
 * The wallet a command acts on: the one `--wallet` names among the agent's wallets, or the agent's
 * default wallet, its oldest one not archived. With none it prints why (`cli.no_wallet`, or the
 * engine's `wallet.not_found` for a wallet named) and answers `undefined`.
 */
export async function chooseWallet(
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
