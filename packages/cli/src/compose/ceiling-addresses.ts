import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRef,
  type FamilyRegistry,
  recipientBytesOf,
  recipientHexBytes,
} from "@binference/chain";
import type { ChainAddresses, HeldBridge } from "@binference/custody-privy";

/** How the accounts the engine names become the addresses a ceiling lists per chain. */
export interface CeilingAddressParts {
  /** The address codec of each CAIP-2 namespace, which gives each account its recipient bytes. */
  readonly families: FamilyRegistry;
  /** The ids a ceiling's rules bind for a chain; none for a chain no rule pays on. */
  readonly chainIdsOf: (chain: ChainRef) => readonly string[];
  /** The chains an id a ceiling's rules bind stands for, the reverse of `chainIdsOf`. */
  readonly chainsOfId: (id: string) => readonly ChainRef[];
}

/**
 * Each account's recipient bytes, listed for each id its chain's rules bind, in the order given
 * (decision 0313): an address saved for Base is listed for Base alone, so a send on BNB Smart
 * Chain never pays it and a bridge to Base may. An account on a chain no rule pays on, such as
 * Solana while no venue declares a deposit there, or one its family cannot read, is listed nowhere.
 */
export function ceilingAddressesOf(
  accounts: readonly AccountRef[],
  parts: CeilingAddressParts,
): readonly ChainAddresses[] {
  const lists = new Map<string, string[]>();
  for (const account of accounts) {
    const bytes = recipientBytesOf(parts.families, account);
    const ids = bytes.ok ? parts.chainIdsOf(accountRefParts(account).chain) : [];
    for (const id of ids) {
      const listed = lists.get(id) ?? [];
      lists.set(id, [...listed, ...(bytes.ok ? [bytes.value] : [])]);
    }
  }
  return [...lists].map(([chainId, addresses]) => ({
    chainId,
    addresses: [...new Set(addresses)],
  }));
}

/**
 * Each account a ceiling's bridge rules pay, on the chain each destination id stands for, in the
 * canonical form of its family's codec: the reverse of {@link ceilingAddressesOf}. A recipient a
 * codec cannot read, or an id no chain stands for, names no account.
 */
export function bridgedAccountsOf(
  bridges: readonly Pick<HeldBridge, "destinationChainId" | "recipients">[],
  parts: CeilingAddressParts,
): readonly AccountRef[] {
  const accounts = bridges.flatMap(({ destinationChainId, recipients }) =>
    parts.chainsOfId(destinationChainId).flatMap((chain) => {
      const codec = parts.families.codecOf(chain);
      return recipients.flatMap((recipient) => {
        const bytes = recipientHexBytes(recipient.toLowerCase());
        const address = codec.ok && bytes.ok ? codec.value.fromBytes(bytes.value) : undefined;
        const account = address?.ok === true ? `${chain}:${address.value}` : undefined;
        return account === undefined ? [] : [accountRefSchema.parse(account)];
      });
    }),
  );
  return [...new Set(accounts)];
}
