import {
  type AccountRef,
  accountRefParts,
  type DecodedDeposit,
  isSameAccount,
  recipientHex,
} from "@binference/chain";
import type { ChosenBridge } from "./choose-bridge.js";
import type { ResolvedBridge } from "./resolve-bridge.js";

/**
 * Whether the hex is 20 bytes in lowercase, the form the signer compares an address input in
 * (decision 0302): a bridge deposit's recipient and tokens are bound only in it.
 */
export function isSignerAddress(hex: string): boolean {
  return /^0x[0-9a-f]{40}$/u.test(hex);
}

// Whether the signer can hold the deposit to its recipient: a venue that declares its deposit's
// recipient input on the chain gets that input bound only to 20 bytes, so a payee of any other
// length would reach a card the signer refuses.
function isBindable(bridge: ResolvedBridge, chosen: ChosenBridge): boolean {
  const declared = chosen.candidate.hosted.bridge.contracts
    .filter((contracts) => contracts.chain === bridge.chain.ref)
    .some((contracts) => (contracts.calls ?? []).some((call) => call.bridge !== undefined));
  return !declared || isSignerAddress(bridge.payee.recipientBytes);
}

// A bound deposit's recipient is the payee, as the destination's codec gives its bytes, in a form
// the signer can bind, its delivered token the route's, its least output at least the quote's,
// and its deadline no earlier than the quote's expiry (decision 0317).
function isBoundAsPlanned(
  deposit: Extract<DecodedDeposit, { readonly kind: "bound" }>,
  bridge: ResolvedBridge,
  chosen: ChosenBridge,
): boolean {
  const { chain, address } = accountRefParts(deposit.recipient);
  const bytes = bridge.destination.codec.toBytes(address);
  return (
    chain === bridge.destination.ref &&
    bytes.ok &&
    recipientHex(bytes.value) === bridge.payee.recipientBytes &&
    isBindable(bridge, chosen) &&
    deposit.minOut.asset === chosen.candidate.route.arrives &&
    deposit.minOut.base >= chosen.quote.minOut.base &&
    deposit.fillDeadlineMs >= chosen.quote.expiresAtMs
  );
}

/**
 * Whether the deposit the bridge built is the one its plan names (decisions 0317 and 0319): it
 * calls one of the venue's declared contracts, from the wallet, with exactly the amount sent; a
 * bound deposit pays the payee the route's token, at least the quote's least output, until no
 * earlier than its expiry, to a recipient the signer can bind; an order deposit comes only from the agent's bridge wallet, since no
 * ceiling reads who its order pays.
 */
export function isDepositAsPlanned(
  deposit: DecodedDeposit,
  bridge: ResolvedBridge,
  chosen: ChosenBridge & { readonly contracts: readonly AccountRef[] },
): boolean {
  const { family } = bridge.chain;
  const isOwn =
    chosen.contracts.some((contract) => isSameAccount(contract, deposit.contract, family)) &&
    isSameAccount(deposit.depositor, bridge.account, family) &&
    deposit.amountIn.asset === bridge.amount.asset &&
    deposit.amountIn.base === bridge.amount.base;
  if (!isOwn) {
    return false;
  }
  return deposit.kind === "bound"
    ? isBoundAsPlanned(deposit, bridge, chosen)
    : bridge.walletRecord?.role === "bridge";
}
