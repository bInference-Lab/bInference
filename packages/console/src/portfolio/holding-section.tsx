import { addressPartOf, assetText, displayOutsideText, shortAddress } from "@binference/i18n";
import type { AssetInfos, BalanceView, WalletView } from "@binference/protocol";
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
 * USD value, or a word that a balance has no price, then the mode's own total.
 */
export function HoldingSectionView(props: {
  readonly section: HoldingSection;
  readonly wallets: ReadonlyMap<string, WalletView>;
  readonly assets: AssetInfos;
}): React.JSX.Element {
  const { section, wallets, assets } = props;
  const text = useText();
  const id = useId();
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
      <SectionTotal section={section} />
    </section>
  );
}
