import { accountRefParts } from "@binference/chain";
import {
  type DepositWallet,
  depositWarnings,
  displayOutsideText,
  walletRoleOf,
} from "@binference/i18n";
import type { WalletView } from "@binference/protocol";
import type { RichLine, RichRun } from "@binference/rich-text";
import type { CommandContext } from "./command-context.js";

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
  const role = parts.words("cmd.wallet.role", { role: walletRoleOf(view) });
  const label = displayOutsideText(view.label, labelLength);
  return [
    lineOf([
      { text: label, marks: [{ kind: "bold" }] },
      { text: ` · ${role}`, marks: [] },
    ]),
    lineOf([{ text: address, marks: [{ kind: "code" }] }]),
    lineOf([]),
    ...depositWarnings(parts.formatter, wallet, chainName).map(quoteLine),
    ...(template === undefined ? [] : [lineOf([])]),
    ...explorerLines(parts, template?.replace("{address}", address)),
  ];
}
