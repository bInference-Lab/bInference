import { type CardDisplay, cardLineText } from "@binference/engine/surfaces";
import type {
  BalanceView,
  CardValueView,
  PortfolioView,
  PositionView,
  ProtocolId,
} from "@binference/protocol";
import { amountValue, assetValue } from "./asset-values.js";
import { callOrSay, type CommandContext } from "./command-context.js";

type Values = Readonly<Record<string, CardValueView>>;

/** A wallet's part of the portfolio: its paper or its live holdings. */
interface WalletPart<T> {
  readonly wallet: ProtocolId<"wallet">;
  readonly isPaper: boolean;
  readonly items: readonly T[];
}

// `/balance` names a wallet's top holdings by value; `/positions` lists every one.
const topHoldings = 5;
const indent = "  ";

// Each wallet's paper and live holdings apart, in the order the portfolio first names them.
function partsOf<T extends { readonly wallet: ProtocolId<"wallet">; readonly paper: boolean }>(
  items: readonly T[],
): readonly WalletPart<T>[] {
  const keys = [...new Set(items.map((item) => `${item.wallet} ${String(item.paper)}`))];
  return keys.flatMap((key) => {
    const inPart = items.filter((item) => `${item.wallet} ${String(item.paper)}` === key);
    const [first] = inPart;
    return first === undefined
      ? []
      : [{ wallet: first.wallet, isPaper: first.paper, items: inPart }];
  });
}

// Each wallet's label, or its id when the wallets cannot be read.
async function labelsOf(context: CommandContext): Promise<ReadonlyMap<string, string>> {
  const { calls, senderId, signal } = context;
  const listed = await calls.call({ op: "wallet/list", args: {}, senderId }, { signal });
  const wallets = listed.ok ? listed.value.items : [];
  return new Map(wallets.map((wallet) => [wallet.wallet, wallet.label]));
}

function line(display: CardDisplay, key: string, values: Values): string {
  return cardLineText({ key, values }, display);
}

function modeValue(mode: "paper" | "live"): CardValueView {
  const choice = { type: "choice", choice: mode } as const;
  return { type: "line", line: { key: "cmd.mode", values: { mode: choice } } };
}

const usd = (usdMicros: bigint): CardValueView => ({ type: "usd", usdMicros });

function walletValues<T>(part: WalletPart<T>, labels: ReadonlyMap<string, string>): Values {
  return {
    wallet: { type: "text", text: labels.get(part.wallet) ?? part.wallet },
    mode: modeValue(part.isPaper ? "paper" : "live"),
  };
}

function holdingLine(display: CardDisplay, balance: BalanceView): string {
  const amount = amountValue(balance.amount, display.assets);
  return balance.usdMicros === undefined
    ? line(display, "cmd.balance.noPrice", { amount })
    : line(display, "cmd.balance.holding", {
        amount,
        value: { type: "usd", usdMicros: balance.usdMicros },
      });
}

// The holdings with the highest value first; one without a price comes last.
function byValue(left: BalanceView, right: BalanceView): number {
  const [a, b] = [left.usdMicros ?? -1n, right.usdMicros ?? -1n];
  if (a === b) {
    return 0;
  }
  return b > a ? 1 : -1;
}

interface PartDisplay {
  readonly context: CommandContext;
  readonly display: CardDisplay;
  readonly labels: ReadonlyMap<string, string>;
}

function balancePartLines(on: PartDisplay, part: WalletPart<BalanceView>): readonly string[] {
  const total = part.items.reduce((sum, balance) => sum + (balance.usdMicros ?? 0n), 0n);
  const holdings = part.items.toSorted(byValue);
  const more = holdings.length - topHoldings;
  const heading = line(on.display, "cmd.balance.wallet", {
    ...walletValues(part, on.labels),
    total: { type: "usd", usdMicros: total },
  });
  const named = holdings.slice(0, topHoldings).map((balance) => holdingLine(on.display, balance));
  const rest = more > 0 ? [on.context.words("cmd.balance.more", { count: more })] : [];
  return [heading, ...[...named, ...rest].map((text) => `${indent}${text}`)];
}

// The live total and the paper total, each on its own line and never added together.
function totalLines(display: CardDisplay, view: PortfolioView): readonly string[] {
  const total = (mode: "paper" | "live", usdMicros: bigint): string =>
    line(display, "cmd.balance.total", { mode: modeValue(mode), total: usd(usdMicros) });
  const live = view.balances.some(({ paper }) => !paper)
    ? [total("live", view.totalUsdMicros)]
    : [];
  const paper =
    view.paperTotalUsdMicros === undefined ? [] : [total("paper", view.paperTotalUsdMicros)];
  return [...live, ...paper];
}

/**
 * `/balance`: each wallet's total in USD and its top holdings by value (spec 4, section 5), live
 * holdings before paper ones, then the live total and the paper total apart.
 */
export async function runBalance(context: CommandContext): Promise<void> {
  const view = await callOrSay(context, "portfolio/get", {});
  if (view === undefined) {
    return;
  }
  if (view.balances.length === 0) {
    await context.say(context.words("cmd.balance.empty"));
    return;
  }
  const on = {
    context,
    display: { formatter: context.formatter, assets: view.assets },
    labels: await labelsOf(context),
  };
  const lines = partsOf(view.balances).flatMap((part) => balancePartLines(on, part));
  await context.say([...lines, ...totalLines(on.display, view)].join("\n"));
}

function positionValues(position: PositionView, display: CardDisplay): Values {
  const unrealized = position.unrealizedUsdMicros ?? 0n;
  const decimals = display.assets[position.asset]?.decimals;
  const each =
    decimals === undefined || position.quantity === 0n
      ? position.costUsdMicros
      : (position.costUsdMicros * 10n ** BigInt(decimals)) / position.quantity;
  return {
    asset: assetValue(position.asset, display.assets),
    amount: amountValue({ asset: position.asset, base: position.quantity }, display.assets),
    value: { type: "usd", usdMicros: position.costUsdMicros + unrealized },
    cost: { type: "usd", usdMicros: each },
    pnl: { type: "usd", usdMicros: position.realizedUsdMicros + unrealized },
  };
}

// A closed position shows what it realized; an open one its value now when a price is known, and
// its average cost each, or what it paid in all when the token's decimals are not known.
function positionKey(position: PositionView, display: CardDisplay): string {
  if (position.quantity === 0n) {
    return "cmd.positions.closed";
  }
  if (display.assets[position.asset] === undefined) {
    return "cmd.positions.openUnknown";
  }
  return position.unrealizedUsdMicros === undefined
    ? "cmd.positions.openNoPrice"
    : "cmd.positions.open";
}

function positionPartLines(on: PartDisplay, part: WalletPart<PositionView>): readonly string[] {
  const { display } = on;
  const heading = line(display, "cmd.positions.wallet", walletValues(part, on.labels));
  const positions = part.items.map((position) =>
    line(display, positionKey(position, display), positionValues(position, display)),
  );
  return [heading, ...positions.map((text) => `${indent}${text}`)];
}

/** `/positions`: each position's amount, value, average cost and P&L, wallet by wallet. */
export async function runPositions(context: CommandContext): Promise<void> {
  const view = await callOrSay(context, "portfolio/get", {});
  if (view === undefined) {
    return;
  }
  if (view.positions.length === 0) {
    await context.say(context.words("cmd.positions.empty"));
    return;
  }
  const on = {
    context,
    display: { formatter: context.formatter, assets: view.assets },
    labels: await labelsOf(context),
  };
  const lines = partsOf(view.positions).flatMap((part) => positionPartLines(on, part));
  await context.say(lines.join("\n"));
}
