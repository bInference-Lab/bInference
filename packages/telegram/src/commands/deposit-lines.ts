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

/** What the deposit lines are written with: the words and the formatter. */
type LineParts = Pick<CommandContext, "words" | "formatter">;

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

// The address's page the engine named, labelled by the explorer's host.
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

/**
 * A wallet's lines for the owner (spec 4, section 5): its label in bold and its role, its full
 * address in `code` the owner taps to copy, a quote of what to know before sending to it, and its
 * page on the first block explorer the chain registry lists. The chain's name and the page come
 * from the engine's view; a view from an older engine names the chain by its id and shows no link.
 */
export function depositLines(parts: LineParts, wallet: DepositWallet): readonly RichLine[] {
  const { view } = wallet;
  const { address, chain } = accountRefParts(view.address);
  const chainName = view.chainName ?? chain;
  const page = view.explorerLink;
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
    ...(page === undefined ? [] : [lineOf([])]),
    ...explorerLines(parts, page),
  ];
}
