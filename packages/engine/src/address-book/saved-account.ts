import {
  type AccountKindReader,
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type AddressCodec,
  type ChainRef,
  type ChainRegistry,
  recipientHex,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { DestinationChain } from "./destination-chain.js";

/** Where the address book may save an address: the wallets' chains and the bridges' destinations. */
export interface AddressChains {
  readonly chains: ChainRegistry;
  readonly destinations: readonly DestinationChain[];
}

/** An account the owner may save, as its chain's family reads it. */
export interface SavedAccount {
  /** The account in its family's canonical form. */
  readonly account: AccountRef;
  /** Its recipient bytes, in lowercase hex. */
  readonly recipientBytes: string;
  /** Whether it is on a chain of the agent's wallets, which a send pays on; else a destination. */
  readonly isWalletChain: boolean;
  /** The reader that tells a wallet from a program on its chain, where its family needs one. */
  readonly kinds?: AccountKindReader;
}

// The codec of a chain the address book saves on: a wallet chain's family's, else a destination's;
// a chain that is neither is `address.unknown_chain`.
function codecOn(parts: AddressChains, chain: ChainRef): Result<AddressCodec, ProtocolErrorCode> {
  const registered = parts.chains.get(chain);
  const codec = registered.ok
    ? registered.value.family.addressCodec
    : parts.destinations.find((item) => item.ref === chain)?.codec;
  return codec === undefined ? err("address.unknown_chain") : ok(codec);
}

// Every codec the address book knows, one per namespace.
function codecsOf(parts: AddressChains): readonly AddressCodec[] {
  const all = [
    ...parts.chains.list().map((item) => item.family.addressCodec),
    ...parts.destinations.map((item) => item.codec),
  ];
  return all.filter(
    (codec, index) => all.findIndex((item) => item.namespace === codec.namespace) === index,
  );
}

/**
 * The account `address/add` names (decisions 0297 and 0298): its address checked by its chain's
 * family codec, a checksum on an EVM chain and 32 bytes of base58 on Solana, with its recipient
 * bytes. A chain that is neither a wallet's nor a destination is `address.unknown_chain`; an
 * address another family reads, such as a Solana address named for Base, `address.other_chain`;
 * any other text the codec refuses `address.malformed`.
 */
export function savedAccountOf(
  parts: AddressChains,
  asked: { readonly chain: ChainRef; readonly address: string },
): Result<SavedAccount, ProtocolErrorCode> {
  const found = codecOn(parts, asked.chain);
  if (!found.ok) {
    return found;
  }
  const codec = found.value;
  const bytes = codec.toBytes(asked.address);
  const canonical = codec.parse(asked.address);
  if (!bytes.ok || !canonical.ok) {
    const elsewhere = codecsOf(parts).some(
      (other) => other.namespace !== codec.namespace && other.parse(asked.address).ok,
    );
    return err(elsewhere ? "address.other_chain" : "address.malformed");
  }
  const account = accountRefSchema.safeParse(`${asked.chain}:${canonical.value}`);
  if (!account.success) {
    return err("address.malformed");
  }
  const isWalletChain = parts.chains.get(asked.chain).ok;
  const kinds = parts.destinations.find((item) => item.ref === asked.chain)?.kinds;
  return ok({
    account: account.data,
    recipientBytes: recipientHex(bytes.value),
    isWalletChain,
    ...(kinds === undefined ? {} : { kinds }),
  });
}

/**
 * Whether the account is one of the install's wallets on a destination chain, as its recipient
 * bytes read through the destination's codec: no bridge may pay binference's own address on
 * another chain. A wallet whose address the codec does not read, of another family, is none.
 */
export function isOwnWalletElsewhere(
  parts: AddressChains,
  saved: SavedAccount,
  walletAddresses: readonly string[],
): boolean {
  const { chain } = accountRefParts(saved.account);
  const codec = parts.destinations.find((item) => item.ref === chain)?.codec;
  return (
    codec !== undefined &&
    walletAddresses.some((address) => {
      const bytes = codec.toBytes(address);
      return bytes.ok && recipientHex(bytes.value) === saved.recipientBytes;
    })
  );
}
