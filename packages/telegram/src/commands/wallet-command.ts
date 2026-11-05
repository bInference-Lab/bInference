import { accountRefParts } from "@binference/chain";
import { type CardDisplay, cardLineText } from "@binference/i18n";
import type { AgentMode, WalletView } from "@binference/protocol";
import type { RichLine, RichRun } from "../format/rich-line.js";
import { chooseAgent } from "./agent-commands.js";
import { callOrSay, type CommandContext } from "./command-context.js";

/** What a wallet is for, as `cmd.wallet.item` names it. */
type WalletRole = "agent" | "launch" | "bridge" | "extraLaunch" | "extraBridge";

const textBlock = { kind: "text" } as const;

function roleOf(view: WalletView): WalletRole {
  const isExtra = view.extra === true;
  if (view.role === "launch") {
    return isExtra ? "extraLaunch" : "launch";
  }
  if (view.bridge === true) {
    return isExtra ? "extraBridge" : "bridge";
  }
  return "agent";
}

function lineOf(runs: readonly RichRun[]): RichLine {
  return { block: textBlock, runs };
}

// The address's page from the explorer's page template, labelled by the explorer's host.
function explorerLines(context: CommandContext, page: string | undefined): readonly RichLine[] {
  if (page === undefined) {
    return [];
  }
  const label = context.words("cmd.wallet.explorer", { explorer: new URL(page).host });
  return [lineOf([{ text: label, marks: [{ kind: "link", href: page }] }])];
}

// The chain's name and first explorer come from the registry; a chain it does not list keeps the
// engine's name for it and shows no link.
function walletLines(
  context: CommandContext,
  wallet: { readonly view: WalletView; readonly mode: AgentMode },
): readonly RichLine[] {
  const { view, mode } = wallet;
  const { chain, address } = accountRefParts(view.address);
  const registered = context.chains.get(chain);
  const definition = registered.ok ? registered.value.definition : undefined;
  const template = definition?.explorers[0]?.addressUrl;
  const display: CardDisplay = { formatter: context.formatter, assets: {} };
  const modeLine = { key: "cmd.mode", values: { mode: { type: "choice", choice: mode } } } as const;
  const item = cardLineText(
    {
      key: "cmd.wallet.item",
      values: {
        wallet: { type: "text", text: view.label },
        role: { type: "choice", choice: roleOf(view) },
        chain: { type: "text", text: definition?.name ?? view.chainName ?? chain },
        mode: { type: "line", line: modeLine },
      },
    },
    display,
  );
  return [
    lineOf([{ text: item, marks: [] }]),
    lineOf([{ text: address, marks: [{ kind: "code" }] }]),
    ...explorerLines(context, template?.replace("{address}", address)),
  ];
}

/**
 * `/wallet`: the agent's wallets (spec 4, section 5), archived ones left out, each with the
 * owner's label, its role, its chain and the agent's mode, then its full address in `code`, which
 * the owner taps to copy, and its page on the chain's block explorer.
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
  // A blank line between wallets, so a message splits between them rather than inside one.
  const lines = views
    .map((view) => walletLines(context, { view, mode: agent.mode }))
    .reduce<readonly RichLine[]>(
      (shown, next) => (shown.length === 0 ? next : shown.concat([lineOf([])], next)),
      [],
    );
  await context.sayRich(lines);
}
