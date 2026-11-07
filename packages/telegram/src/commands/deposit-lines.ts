import { accountRefParts } from "@binference/chain";
import { displayOutsideText } from "@binference/i18n";
import type { AgentMode, WalletView } from "@binference/protocol";
import type { RichLine, RichRun } from "@binference/rich-text";
import type { CommandContext } from "./command-context.js";

/** What a wallet is for, as `cmd.wallet.role` names it. */
type WalletRole = "agent" | "launch" | "bridge" | "extraLaunch" | "extraBridge";

/** A wallet as its deposit lines show it: the wallet, and its agent's mode and freeze. */
export interface DepositWallet {
  readonly view: WalletView;
  readonly mode: AgentMode;
  readonly isFrozen: boolean;
}

/** What the deposit lines are written with: the words, the formatter, and the chains if known. */
type LineParts = Pick<CommandContext, "words" | "formatter"> & {
  readonly chains?: CommandContext["chains"];
};

const textBlock = { kind: "text" } as const;

/** A launch or bridge wallet beyond the agent's own of that role: nothing runs from it. */
export function isExtraWallet(view: WalletView): boolean {
  return view.extra === true;
}

/** The wallet's address as its chain writes it, the text a deposit's QR code holds. */
export function walletAddressOf(view: WalletView): string {
  return accountRefParts(view.address).address;
}

function roleOf(view: WalletView): WalletRole {
  const isExtra = isExtraWallet(view);
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
function explorerLines(parts: LineParts, page: string | undefined): readonly RichLine[] {
  if (page === undefined) {
    return [];
  }
  const label = parts.words("cmd.wallet.explorer", { explorer: new URL(page).host });
  return [lineOf([{ text: label, marks: [{ kind: "link", href: page }] }])];
}

// The longest wallet label the title shows; the owner wrote it, so it shows as outside text.
const labelLength = 64;
// The quote block the warnings sit in; a caption holds one.
const warningBlock = { kind: "quote", block: 1 } as const;

function quoteLine(text: string): RichLine {
  return { block: warningBlock, runs: [{ text, marks: [] }] };
}

// What the owner must know before sending: the network, a paper agent's real funds, a freeze; and
// for a wallet nothing runs from, to send it nothing.
function warningLines(parts: LineParts, wallet: DepositWallet, chain: string): readonly RichLine[] {
  if (isExtraWallet(wallet.view)) {
    return [quoteLine(parts.words("cmd.wallet.extraFunds"))];
  }
  return [
    quoteLine(parts.words("cmd.wallet.network", { chain })),
    ...(wallet.mode === "paper" ? [quoteLine(parts.words("cmd.wallet.paperFunds"))] : []),
    ...(wallet.isFrozen ? [quoteLine(parts.words("cmd.wallet.frozenFunds"))] : []),
  ];
}

// The wallet's chain as the registry names it, with its first explorer's address page; a chain the
// registry does not list keeps the engine's name for it and has no page.
function chainOf(
  parts: LineParts,
  view: WalletView,
): { readonly chainName: string; readonly template?: string } {
  const { chain } = accountRefParts(view.address);
  const registered = parts.chains?.get(chain);
  const definition = registered?.ok === true ? registered.value.definition : undefined;
  const template = definition?.explorers[0]?.addressUrl;
  const chainName = definition?.name ?? view.chainName ?? chain;
  return template === undefined ? { chainName } : { chainName, template };
}

/**
 * A wallet's lines for the owner (spec 4, section 5): its label in bold and its role, its full
 * address in `code` the owner taps to copy, a quote of what to know before sending to it, and its
 * page on the first block explorer the chain registry lists. The chain's name comes from the
 * registry; a chain it does not list keeps the engine's name for it and shows no link.
 */
export function depositLines(parts: LineParts, wallet: DepositWallet): readonly RichLine[] {
  const { view } = wallet;
  const { address } = accountRefParts(view.address);
  const { chainName, template } = chainOf(parts, view);
  const role = parts.words("cmd.wallet.role", { role: roleOf(view) });
  const label = displayOutsideText(view.label, labelLength);
  return [
    lineOf([
      { text: label, marks: [{ kind: "bold" }] },
      { text: ` · ${role}`, marks: [] },
    ]),
    lineOf([{ text: address, marks: [{ kind: "code" }] }]),
    lineOf([]),
    ...warningLines(parts, wallet, chainName),
    ...(template === undefined ? [] : [lineOf([])]),
    ...explorerLines(parts, template?.replace("{address}", address)),
  ];
}
