import { type AccountRef, accountRefParts, BinferenceError } from "@binference/plugin-sdk";
import { parseEvmAddress } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";

/** Flap's Portal: it quotes, and trades every token on a Flap curve. */
export const portalName = "portal";

// The address of an EVM account, in checksum form.
function addressOf(account: AccountRef): Address {
  const address = parseEvmAddress(accountRefParts(account).address);
  if (!address.ok) {
    throw new BinferenceError({
      code: "flap.not_evm",
      message: "Flap trades only from and with EVM accounts.",
    });
  }
  return address.value;
}

/** The Portal among the contracts the host gave with a request; none is a fault. */
export function portalAccountOf(contracts: Readonly<Record<string, AccountRef>>): AccountRef {
  const portal = contracts[portalName];
  if (portal === undefined) {
    throw new BinferenceError({
      code: "flap.no_contract",
      message: "The request carries no Portal; the venue declares it on every chain.",
      details: { name: portalName },
    });
  }
  return portal;
}

/** The Portal among the contracts the host gave with a request, as an EVM address. */
export function portalOf(contracts: Readonly<Record<string, AccountRef>>): Address {
  return addressOf(portalAccountOf(contracts));
}
