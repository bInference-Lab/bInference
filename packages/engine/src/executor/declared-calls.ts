import {
  type AccountRef,
  accountRefSchema,
  type AllowedTargets,
  type DeclaredCall,
  declaredAddress,
  type RegisteredChain,
  type VenueContracts,
  type VenueDeclaration,
  type WalletOnlySpender,
  walletRoleSchema,
} from "@binference/chain";
import { callInputChecksOf } from "./call-input-checks.js";
import { unapprovedTargetsOf } from "./unapproved-targets.js";

// Each venue's entry on the chain, with the venue it belongs to.
function entriesOn(
  chain: RegisteredChain,
  venues: readonly VenueDeclaration[],
): readonly { readonly venue: VenueDeclaration; readonly entry: VenueContracts }[] {
  return venues.flatMap((venue) =>
    venue.contracts.filter((item) => item.chain === chain.ref).map((entry) => ({ venue, entry })),
  );
}

// The account of a contract the venue names on the chain; undefined for a name the registry
// does not list, such as a launch's own contract.
function accountOf(
  chain: RegisteredChain,
  venue: VenueDeclaration,
  name: string,
): AccountRef | undefined {
  const found = declaredAddress(venue, chain, name);
  return found.ok ? accountRefSchema.parse(`${chain.ref}:${found.value}`) : undefined;
}

/**
 * The functions the venues declare on their contracts on a chain (decision 0302), for the signer
 * to refuse any other function on those contracts: each call on a registry contract with that
 * contract's account, and each call on a launch's own contracts with none. A call on a name
 * neither lists adds nothing.
 */
export function declaredCallsOf(
  chain: RegisteredChain,
  venues: readonly VenueDeclaration[],
): readonly DeclaredCall[] {
  return entriesOn(chain, venues).flatMap(({ venue, entry }) =>
    (entry.calls ?? []).flatMap((call): readonly DeclaredCall[] => {
      if (entry.launchContracts?.includes(call.contract) === true) {
        return [{ abi: call.abi }];
      }
      const contract = accountOf(chain, venue, call.contract);
      return contract === undefined ? [] : [{ contract, abi: call.abi }];
    }),
  );
}

/**
 * The spenders the venues let only a wallet of one role approve on a chain (decision 0303), such
 * as Relay's depository, a bridge wallet's alone, for the signer to refuse from any other wallet.
 */
export function walletOnlySpendersOf(
  chain: RegisteredChain,
  venues: readonly VenueDeclaration[],
): readonly WalletOnlySpender[] {
  return entriesOn(chain, venues).flatMap(({ venue, entry }) =>
    Object.entries(entry.onlyWalletSpenders ?? {}).flatMap(
      ([role, names]: readonly [string, readonly string[] | undefined]) =>
        (names ?? []).flatMap((name): readonly WalletOnlySpender[] => {
          const spender = accountOf(chain, venue, name);
          const parsed = walletRoleSchema.safeParse(role);
          return spender === undefined || !parsed.success ? [] : [{ role: parsed.data, spender }];
        }),
    ),
  );
}

/**
 * What the signer reads from the venues' declarations for a step on a chain, beside its contracts:
 * the calls only a wallet of one role makes (decision 0271), the contracts no approval goes to
 * (decision 0304) among every venue's, and from the route's venues the input checks, the declared
 * functions and the spenders of one role (decisions 0302 and 0303). An empty list is left out.
 */
export function declaredTargetsOf(
  chain: RegisteredChain,
  venues: { readonly used: readonly VenueDeclaration[]; readonly all: readonly VenueDeclaration[] },
): Omit<AllowedTargets, "contracts" | "spenders" | "recipients"> {
  const walletOnlyCalls = entriesOn(chain, venues.used)
    .flatMap(({ entry }) => entry.calls ?? [])
    .flatMap(({ onlyWallet, abi }) =>
      onlyWallet === undefined ? [] : [{ role: onlyWallet, abi }],
    );
  const unapproved = unapprovedTargetsOf(chain, venues.all);
  const callInputs = callInputChecksOf(chain, venues.used);
  const calls = declaredCallsOf(chain, venues.used);
  const walletOnlySpenders = walletOnlySpendersOf(chain, venues.used);
  return {
    ...(walletOnlyCalls.length === 0 ? {} : { walletOnlyCalls }),
    ...(unapproved.length === 0 ? {} : { unapproved }),
    ...(callInputs.length === 0 ? {} : { callInputs }),
    ...(calls.length === 0 ? {} : { calls }),
    ...(walletOnlySpenders.length === 0 ? {} : { walletOnlySpenders }),
  };
}
