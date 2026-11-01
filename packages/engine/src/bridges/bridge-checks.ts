import { type AccountCodeReader, type AccountRef, accountRefParts } from "@binference/chain";
import { isWalletAccount } from "../address-book/address-checks.js";
import type { CeilingEditor } from "../install/ports.js";
import type { QuoteFailure } from "../intents/intent-reason.js";
import type { Holdings } from "../money-path/wallet-facts.js";
import type { ResolvedBridge } from "./resolve-bridge.js";

/** What a bridge's checks before its quote read (decisions 0318 and 0319). */
export interface BridgeCheckParts {
  /** Reads a wallet's stored copy of its ceiling, with no call to custody. */
  readonly ceilings: Pick<CeilingEditor, "readStored">;
  readonly holdings: Holdings;
  /** The account code readers of the wallets' chains, which tell a plain wallet from code. */
  readonly codeReaders: readonly AccountCodeReader[];
}

// Whom the wallet's stored ceiling's bridge rules pay; `any` for a bridge wallet's routes, which
// need none, and none for a wallet without a stored ceiling.
function bridgedOf(parts: BridgeCheckParts, bridge: ResolvedBridge): readonly AccountRef[] | "any" {
  if (bridge.candidates.length > 0 && bridge.candidates.every((item) => item.isBridgeWallets)) {
    return "any";
  }
  const policy = bridge.walletRecord?.ceiling.policy;
  return (policy === undefined ? undefined : parts.ceilings.readStored(policy))?.bridged ?? [];
}

// What the wallet's stored ceiling says of the payee (decision 0319): a bridge wallet's deposits
// name no recipient, so its routes need no rule (decision 0307); a main wallet's ceiling must list
// the payee in a bridge rule on its chain. The rescue address listed on its own chain only is
// `rescue_unpaid`; a chain no bridge rule reaches `bridge_chain_unpaid`; an entry missing from a
// rule that reaches its chain `ceiling_lacks_payee`.
function ceilingRefusal(parts: BridgeCheckParts, bridge: ResolvedBridge): QuoteFailure | undefined {
  const bridged = bridgedOf(parts, bridge);
  const { payee, destination } = bridge;
  if (bridged === "any" || bridged.includes(payee.account)) {
    return undefined;
  }
  if (payee.rescueHome !== undefined) {
    return "rescue_unpaid";
  }
  const reaches = bridged.some((account) => accountRefParts(account).chain === destination.ref);
  return reaches ? "ceiling_lacks_payee" : "bridge_chain_unpaid";
}

// The rescue address holds no code on its own chain and none on the destination: the same key
// holds it on both (decisions 0297 and 0318). A chain with no reader counts as code; a read that
// fails rejects.
async function isPlainOnBoth(
  readers: { readonly here?: AccountCodeReader; readonly there?: AccountCodeReader },
  accounts: { readonly home: AccountRef; readonly there: AccountRef },
  signal: AbortSignal,
): Promise<boolean> {
  const { here, there } = readers;
  if (here === undefined || there === undefined) {
    return false;
  }
  const read = await Promise.all([
    here.read(accounts.home, { signal }),
    there.read(accounts.there, { signal }),
  ]);
  return read.every((code) => code === "none");
}

// Whether the payee may be paid there: the rescue address only where it holds no code on either
// chain, an entry only where its chain's readers find a wallet (decision 0318).
async function isPayable(
  parts: BridgeCheckParts,
  bridge: ResolvedBridge,
  signal: AbortSignal,
): Promise<boolean> {
  const { payee, destination } = bridge;
  const home = payee.rescueHome;
  if (home === undefined) {
    return isWalletAccount({ ...destination, account: payee.account }, signal);
  }
  const here = parts.codeReaders.find((reader) => reader.chain === accountRefParts(home).chain);
  const readers = {
    ...(here === undefined ? {} : { here }),
    ...(destination.codes === undefined ? {} : { there: destination.codes }),
  };
  return isPlainOnBoth(readers, { home, there: payee.account }, signal);
}

// What the payee's reads say: `rescue_not_plain` or `recipient_not_wallet` when it may not be paid
// there, and `recipient_unread` when a read fails.
async function payeeRefusal(
  parts: BridgeCheckParts,
  bridge: ResolvedBridge,
  signal: AbortSignal,
): Promise<QuoteFailure | undefined> {
  try {
    if (await isPayable(parts, bridge, signal)) {
      return undefined;
    }
    return bridge.payee.rescueHome === undefined ? "recipient_not_wallet" : "rescue_not_plain";
  } catch {
    signal.throwIfAborted();
    return "recipient_unread";
  }
}

/**
 * The checks of a bridge after its policy passed and before its quote (decisions 0318 and 0319),
 * so before each card: the payee's code is read again (`rescue_not_plain`, `recipient_not_wallet`,
 * `recipient_unread`), so a ceiling's word comes only for a payee that may be paid; a main
 * wallet's stored ceiling must pay the recipient on its chain (`rescue_unpaid`,
 * `bridge_chain_unpaid`, `ceiling_lacks_payee`); and the wallet must hold the amount it sends
 * (`nothing_to_sell`, or `balance_unread` when its balance cannot be read). `undefined` when every
 * check passes.
 */
export async function bridgeRefusal(
  parts: BridgeCheckParts,
  bridge: ResolvedBridge,
  signal: AbortSignal,
): Promise<QuoteFailure | undefined> {
  const refused = (await payeeRefusal(parts, bridge, signal)) ?? ceilingRefusal(parts, bridge);
  if (refused !== undefined) {
    return refused;
  }
  const query = { wallet: bridge.wallet, account: bridge.account, isPaper: false };
  const held = await parts.holdings.held({ ...query, asset: bridge.amount.asset }, { signal });
  if (held === undefined) {
    return "balance_unread";
  }
  return held < bridge.amount.base ? "nothing_to_sell" : undefined;
}
