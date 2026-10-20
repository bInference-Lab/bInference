import {
  addressPartOf,
  assetText,
  type CardDisplay,
  displayOutsideText,
  shortAddress,
} from "@binference/i18n";
import type { AssetInfos, BalanceView, PnlCardView, WalletView } from "@binference/protocol";
import { useId } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useFormatter, useText, type Words } from "../i18n/console-text";
import { PnlCard } from "./pnl-card";
import type { HoldingSection, WalletHoldings } from "./portfolio-sections";

// A wallet's label shows up to 64 characters, as on the limits screen.
const labelLength = 64;

function BalanceRow(props: {
  readonly balance: BalanceView;
  readonly assets: AssetInfos;
}): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { amount, usdMicros } = props.balance;
  const info = props.assets[amount.asset];
  return (
    <TableRow>
      <TableCell>
        {info === undefined
          ? shortAddress(addressPartOf(amount.asset))
          : assetText(amount.asset, { formatter, assets: props.assets })}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {info === undefined
          ? text("console.portfolio.baseUnits", { base: amount.base.toString() })
          : formatter.tokenAmount(amount.base, info.decimals)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {usdMicros === undefined ? (
          <span className="text-muted-foreground">{text("console.portfolio.noPrice")}</span>
        ) : (
          formatter.usd(usdMicros)
        )}
      </TableCell>
    </TableRow>
  );
}

function walletName(holdings: WalletHoldings, wallet: WalletView | undefined, text: Words): string {
  if (wallet === undefined) {
    return holdings.wallet;
  }
  return text("console.portfolio.wallet", {
    label: displayOutsideText(wallet.label, labelLength),
    address: shortAddress(addressPartOf(wallet.address)),
  });
}

function WalletTable(props: {
  readonly holdings: WalletHoldings;
  readonly wallet: WalletView | undefined;
  readonly assets: AssetInfos;
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <h4 id={id} className="text-sm text-muted-foreground">
        {walletName(props.holdings, props.wallet, text)}
      </h4>
      <Table aria-labelledby={id}>
        <TableHeader>
          <TableRow>
            <TableHead>{text("console.portfolio.asset")}</TableHead>
            <TableHead className="text-right">{text("console.portfolio.amount")}</TableHead>
            <TableHead className="text-right">{text("console.portfolio.value")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.holdings.balances.map((balance) => (
            <BalanceRow key={balance.amount.asset} balance={balance} assets={props.assets} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CardList(props: {
  readonly title: string;
  readonly empty: string;
  readonly cards: readonly PnlCardView[];
  readonly display: CardDisplay;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <h4 id={id} className="text-sm text-muted-foreground">
        {props.title}
      </h4>
      {props.cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.empty}</p>
      ) : (
        <ul aria-labelledby={id} className="grid gap-3 md:grid-cols-2">
          {props.cards.map((card) => (
            <li key={card.asset}>
              <PnlCard card={card} display={props.display} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The mode's own total, which leaves out a balance with no price and says so.
function SectionTotal(props: { readonly section: HoldingSection }): React.JSX.Element {
  const { mode, totalUsdMicros, hasUnpriced } = props.section;
  const text = useText();
  const total = useFormatter().usd(totalUsdMicros);
  return (
    <p className="text-sm">
      <span className="font-medium tabular-nums">
        {text("console.portfolio.total", { mode, total })}
      </span>
      {hasUnpriced ? (
        <span className="block text-muted-foreground">{text("console.portfolio.unpriced")}</span>
      ) : null}
    </p>
  );
}

/**
 * One mode's part of an agent's portfolio in its own section: each wallet's balances with their
 * USD value, or a word that a balance has no price; the mode's own total; then its open positions
 * and those closed in the last 7 days as P&L cards.
 */
export function HoldingSectionView(props: {
  readonly section: HoldingSection;
  readonly wallets: ReadonlyMap<string, WalletView>;
  readonly assets: AssetInfos;
}): React.JSX.Element {
  const { section, wallets, assets } = props;
  const text = useText();
  const formatter = useFormatter();
  const id = useId();
  const display = { formatter, assets };
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 [section+&]:border-t [section+&]:pt-6"
    >
      <h3 id={id} className="font-semibold">
        {text("console.portfolio.section", { mode: section.mode })}
      </h3>
      {section.wallets.map((holdings) => (
        <WalletTable
          key={holdings.wallet}
          holdings={holdings}
          wallet={wallets.get(holdings.wallet)}
          assets={assets}
        />
      ))}
      {section.wallets.length === 0 ? null : <SectionTotal section={section} />}
      <CardList
        title={text("console.portfolio.open")}
        empty={text("console.portfolio.noOpen")}
        cards={section.open}
        display={display}
      />
      <CardList
        title={text("console.portfolio.closed")}
        empty={text("console.portfolio.noClosed")}
        cards={section.closed}
        display={display}
      />
    </section>
  );
}
