import type { AccountRef, ChainRegistry } from "@binference/chain";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { WalletRecord } from "../install/install-record.js";
import { walletAddressRefusal } from "../install/role-wallet.js";
import { isRegistryContract } from "../operations/is-registry-contract.js";

/**
 * Why the account may not be saved in an address book or made the rescue address: a live launch
 * or bridge wallet of the install (see `walletAddressRefusal`), which the owner funds from outside
 * only, or a contract the registry lists for a venue (`address.venue_contract`, decision 0307),
 * such as Relay's depository or receiver, where a send with an order id appended pays whoever the
 * order names. `undefined` for any other account.
 */
export function payeeRefusal(
  wallets: readonly WalletRecord[],
  account: AccountRef,
  chains: ChainRegistry,
): ProtocolErrorCode | undefined {
  const refusal = walletAddressRefusal(wallets, account, chains);
  if (refusal !== undefined) {
    return refusal;
  }
  return isRegistryContract(account, chains) ? "address.venue_contract" : undefined;
}
