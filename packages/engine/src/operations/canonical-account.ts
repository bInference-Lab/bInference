import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRegistry,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";

/**
 * The account in its chain family's canonical form, on a chain the registry holds. A chain the
 * registry lacks, or an address its family cannot read, is `protocol.bad_args`.
 */
export function canonicalAccount(
  chains: ChainRegistry,
  account: AccountRef,
): Result<AccountRef, ProtocolErrorCode> {
  const { chain, address } = accountRefParts(account);
  const registered = chains.get(chain);
  const parsed = registered.ok ? registered.value.family.parseAddress(address) : undefined;
  return parsed?.ok === true
    ? ok(accountRefSchema.parse(`${chain}:${parsed.value}`))
    : err("protocol.bad_args");
}
