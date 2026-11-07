import { qrPng } from "@binference/qr";
import { chooseAgent } from "./agent-commands.js";
import { callOrSay, type CommandContext } from "./command-context.js";
import { depositLines, isExtraWallet, walletAddressOf } from "./deposit-lines.js";

/**
 * `/wallet`: the agent's wallets (spec 4, section 5), archived ones left out. Each wallet the agent
 * runs from goes as a photo of its address's QR code, made from the address the engine reads from
 * custody, never from chat text, with a caption of its label, role, chain and mode, its full
 * address in `code`, which the owner taps to copy, the network to send on, a warning while the
 * agent trades on paper or is frozen, and its page on the chain's block explorer. A launch or bridge
 * wallet nothing runs from goes as text with no code, and says to send it nothing.
 */
export async function runWallet(context: CommandContext): Promise<void> {
  const agent = await chooseAgent(context);
  if (agent === undefined) {
    return;
  }
  const page = await callOrSay(context, "wallet/list", { agent: agent.id });
  if (page === undefined) {
    return;
  }
  const views = page.items.filter((view) => view.archivedAt === undefined);
  if (views.length === 0) {
    await context.say(context.words("cmd.wallet.none"));
    return;
  }
  // One message per wallet, in order, so each code sits beside its own address.
  await views.reduce(async (previous, view) => {
    await previous;
    const lines = depositLines(context, { view, mode: agent.mode, isFrozen: agent.frozen });
    await (isExtraWallet(view)
      ? context.sayRich(lines)
      : context.sayPhoto(qrPng(walletAddressOf(view)), lines));
  }, Promise.resolve());
}
