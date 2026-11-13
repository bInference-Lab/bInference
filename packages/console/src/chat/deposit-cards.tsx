import {
  addressPartOf,
  type DepositWallet,
  depositWarnings,
  displayOutsideText,
  walletRoleOf,
} from "@binference/i18n";
import type { WalletView } from "@binference/protocol";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { MessageLine } from "../cards/card-line";
import { Button } from "../components/ui/button";
import { useFormatter, useText } from "../i18n/console-text";
import { AddressCode } from "./address-code";
import type { ShownDeposit } from "./chat-entries";

// The longest wallet label the card shows; the owner wrote it, so it shows as outside text.
const labelLength = 64;

// The wallet's chain by the engine's name for it, or by its CAIP-2 id from an older engine.
function chainNameOf(view: WalletView): string {
  return view.chainName ?? view.address.slice(0, view.address.lastIndexOf(":"));
}

function CopyAddress(props: { readonly address: string }): React.JSX.Element {
  const text = useText();
  const [isCopied, setCopied] = useState(false);
  const copy = (): void => {
    navigator.clipboard.writeText(props.address).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {isCopied ? (
          <CheckIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        ) : (
          <CopyIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        )}
        {text("console.chat.copyAddress")}
      </Button>
      <output aria-live="polite" className="text-xs text-muted-foreground">
        {isCopied ? text("console.chat.addressCopied") : ""}
      </output>
    </div>
  );
}

// The address's page on the chain's block explorer, named by the explorer's host.
function ExplorerLink(props: { readonly link: string }): React.JSX.Element {
  const text = useText();
  const { link } = props;
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="w-fit underline underline-offset-2"
    >
      {text("cmd.wallet.explorer", { explorer: new URL(link).host })}
    </a>
  );
}

function DepositCard(props: { readonly wallet: DepositWallet }): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { wallet } = props;
  const { view } = wallet;
  const address = addressPartOf(view.address);
  const label = displayOutsideText(view.label, labelLength);
  const role = text("cmd.wallet.role", { role: walletRoleOf(view) });
  return (
    <section
      aria-label={`${label} · ${role}`}
      className="flex flex-col gap-3 rounded-lg border px-3 py-3 text-sm"
    >
      <p>
        <strong className="font-semibold">{label}</strong> · {role}
      </p>
      <div className="flex flex-wrap items-start gap-3">
        {view.extra === true ? null : <AddressCode address={address} />}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <code className="rounded-sm bg-muted px-2 py-1 font-mono text-xs break-all">
            {address}
          </code>
          <CopyAddress address={address} />
        </div>
      </div>
      <blockquote className="flex flex-col gap-1 border-l-2 border-gold pl-3 text-muted-foreground">
        {depositWarnings(formatter, wallet, chainNameOf(view)).map((warning) => (
          <p key={warning}>
            <MessageLine text={warning} />
          </p>
        ))}
      </blockquote>
      {view.explorerLink === undefined ? null : <ExplorerLink link={view.explorerLink} />}
    </section>
  );
}

/**
 * The wallets the agent showed the owner to fund (`chat/deposit`, decision 0380), a card each, in
 * the words of Telegram's caption: the wallet's label and role, the QR code of the address the
 * engine read from custody, the address as code with a button that copies it, what to know before
 * sending, and the address's page on its block explorer. A wallet nothing runs from gets no code.
 */
export function DepositCards(props: {
  readonly deposit: ShownDeposit;
  readonly agentName: string;
}): React.JSX.Element {
  const text = useText();
  const { mode, frozen, breaker, wallets } = props.deposit;
  return (
    <ul
      aria-label={text("console.chat.deposit", { agent: props.agentName })}
      className="mr-auto flex w-full max-w-[85%] flex-col gap-2"
    >
      {wallets.map((view) => (
        <li key={view.wallet}>
          <DepositCard wallet={{ view, mode, isFrozen: frozen, isBraked: breaker === true }} />
        </li>
      ))}
    </ul>
  );
}
