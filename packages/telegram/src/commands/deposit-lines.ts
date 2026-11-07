import { accountRefParts } from "@binference/chain";
import { type CardDisplay, cardLineText } from "@binference/i18n";
import type { AgentMode, WalletView } from "@binference/protocol";
import type { RichLine, RichRun } from "../format/rich-line.js";
import type { CommandContext } from "./command-context.js";

/** What a wallet is for, as `cmd.wallet.item` names it. */
type WalletRole = "agent" | "launch" | "bridge" | "extraLaunch" | "extraBridge";

/** A wallet as its deposit lines show it: the wallet, and its agent's mode and freeze. */
export interface DepositWallet {
  readonly view: WalletView;
  readonly mode: AgentMode;
  readonly isFrozen: boolean;
}

/** What the deposit lines are written with: the words, the chains and the formatter. */
type LineParts = Pick<CommandContext, "words" | "chains" | "formatter">;

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

function textLine(text: string): RichLine {
  return lineOf([{ text, marks: [] }]);
}

// The address's page from the explorer's page template, labelled by the explorer's host.
function explorerLines(parts: LineParts, page: string | undefined): readonly RichLine[] {
  if (page === undefined) {
    return [];
  }
  const label = parts.words("cmd.wallet.explorer", { explorer: new URL(page).host });
  return [lineOf([{ text: label, marks: [{ kind: "link", href: page }] }])];
}

// What the owner must know before sending: the network, a paper agent's real funds, a freeze; and
// for a wallet nothing runs from, to send it nothing.
function warningLines(parts: LineParts, wallet: DepositWallet, chain: string): readonly RichLine[] {
  if (isExtraWallet(wallet.view)) {
    return [textLine(parts.words("cmd.wallet.extraFunds"))];
  }
  return [
    textLine(parts.words("cmd.wallet.network", { chain })),
    ...(wallet.mode === "paper" ? [textLine(parts.words("cmd.wallet.paperFunds"))] : []),
    ...(wallet.isFrozen ? [textLine(parts.words("cmd.wallet.frozenFunds"))] : []),
  ];
}

/**
 * A wallet's lines for the owner (spec 4, section 5): `cmd.wallet.item`, its full address in
 * `code`, what to know before sending to it, and its page on the first block explorer the chain
 * registry lists. The chain's name comes from the registry; a chain it does not list keeps the
 * engine's name for it and shows no link.
 */
export function depositLines(parts: LineParts, wallet: DepositWallet): readonly RichLine[] {
  const { view, mode } = wallet;
  const { chain, address } = accountRefParts(view.address);
  const registered = parts.chains.get(chain);
  const definition = registered.ok ? registered.value.definition : undefined;
  const chainName = definition?.name ?? view.chainName ?? chain;
  const template = definition?.explorers[0]?.addressUrl;
  const display: CardDisplay = { formatter: parts.formatter, assets: {} };
  const modeLine = { key: "cmd.mode", values: { mode: { type: "choice", choice: mode } } } as const;
  const item = cardLineText(
    {
      key: "cmd.wallet.item",
      values: {
        wallet: { type: "text", text: view.label },
        role: { type: "choice", choice: roleOf(view) },
        chain: { type: "text", text: chainName },
        mode: { type: "line", line: modeLine },
      },
    },
    display,
  );
  return [
    textLine(item),
    lineOf([{ text: address, marks: [{ kind: "code" }] }]),
    ...warningLines(parts, wallet, chainName),
    ...explorerLines(parts, template?.replace("{address}", address)),
  ];
}
