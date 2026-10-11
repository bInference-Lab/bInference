import { type AccountRef, accountRefParts } from "@binference/chain";
import { evmNamespace } from "@binference/chain-evm";
import { privateKeyToAddress } from "viem/accounts";

const evmKey = /^(?:0x)?([0-9a-fA-F]{64})$/;

/**
 * Whether an exported private key controls the wallet's account. An EVM wallet's key must derive
 * its address; a key of no EVM form, or of another address, does not belong. binference makes
 * EVM wallets only: a wallet of another family has no derivation here and counts as its own.
 */
export function keyBelongs(key: string, account: AccountRef): boolean {
  const { chain, address } = accountRefParts(account);
  if (!chain.startsWith(`${evmNamespace}:`)) {
    return true;
  }
  const hex = evmKey.exec(key)?.[1];
  if (hex === undefined) {
    return false;
  }
  try {
    return privateKeyToAddress(`0x${hex}`).toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}
