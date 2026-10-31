import {
  type AccountRef,
  accountRefParts,
  type ChainRegistry,
  type WalletRole,
} from "@binference/chain";
import type { Id } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { InstallStore } from "../ports.js";
import type { WalletRecord } from "./install-record.js";

/**
 * The agent's live wallet of a role among the install's wallets, such as its launch wallet
 * (decision 0217): the first the store lists; `undefined` when it has none. Only a rebuild leaves
 * an agent more than one, and nothing runs from the others (decision 0218).
 */
export function roleWalletIn(
  wallets: readonly WalletRecord[],
  agent: Id<"agt">,
  role: WalletRole,
): WalletRecord | undefined {
  return wallets.find(
    (wallet) =>
      wallet.agentId === agent && wallet.role === role && wallet.archivedAtMs === undefined,
  );
}

/** The agent's live wallet of a role as the install store holds it now; `undefined` for none. */
export async function roleWalletOf(
  install: Pick<InstallStore, "read">,
  asked: { readonly agent: Id<"agt">; readonly role: WalletRole },
  options: { readonly signal: AbortSignal },
): Promise<WalletRecord | undefined> {
  const { wallets } = await install.read(options);
  return roleWalletIn(wallets, asked.agent, asked.role);
}

// The wallets the test keeps whose address is the account, on a chain of the wallet's family. An
// account on a chain the registry lacks matches none.
function walletsAt(
  wallets: readonly WalletRecord[],
  asked: { readonly account: AccountRef; readonly chains: ChainRegistry },
  keeps: (wallet: WalletRecord) => boolean,
): readonly WalletRecord[] {
  const { chain, address } = accountRefParts(asked.account);
  const registered = asked.chains.get(chain);
  if (!registered.ok) {
    return [];
  }
  const { family, definition } = registered.value;
  const typed = family.parseAddress(address);
  return wallets.filter((wallet) => {
    const own = family.parseAddress(wallet.address);
    return keeps(wallet) && wallet.family === definition.family && own.ok && typed.ok
      ? own.value === typed.value
      : false;
  });
}

/**
 * The role of the live wallet of any agent of the install whose address the account is, on a
 * chain of the wallet's family, such as a launch wallet's (decision 0218): the owner funds such a
 * wallet from outside only, so no ceiling may list it and the agent's other wallets can never pay
 * it. `undefined` for any other account, and for one on a chain the registry lacks.
 */
export function roleOfWalletAccount(
  wallets: readonly WalletRecord[],
  account: AccountRef,
  chains: ChainRegistry,
): WalletRole | undefined {
  const [found] = walletsAt(
    wallets,
    { account, chains },
    (wallet) => wallet.role !== undefined && wallet.archivedAtMs === undefined,
  );
  return found?.role;
}

// Why an address may not be saved or made the rescue address, by the role of the wallet it is.
const roleAddressRefusals: Readonly<Record<WalletRole, ProtocolErrorCode>> = {
  launch: "address.launch_wallet",
  bridge: "address.bridge_wallet",
};

/**
 * Why the account may not be saved in an address book or made the rescue address: it is a live
 * launch wallet of the install (`address.launch_wallet`, decision 0218) or a live bridge wallet
 * (`address.bridge_wallet`, decision 0307), which the owner funds from outside only. `undefined`
 * for any other account.
 */
export function walletAddressRefusal(
  wallets: readonly WalletRecord[],
  account: AccountRef,
  chains: ChainRegistry,
): ProtocolErrorCode | undefined {
  const role = roleOfWalletAccount(wallets, account, chains);
  return role === undefined ? undefined : roleAddressRefusals[role];
}

/**
 * Whether the account is the address of any wallet of the install, of any agent and any role,
 * archived or live, on a chain of the wallet's family (decision 0277). An account on a chain the
 * registry lacks is none.
 */
export function isInstallWalletAccount(
  wallets: readonly WalletRecord[],
  account: AccountRef,
  chains: ChainRegistry,
): boolean {
  return walletsAt(wallets, { account, chains }, () => true).length > 0;
}

/**
 * The agent's default wallet among `owned`, its live wallets oldest first: the first with no role,
 * never a launch or bridge wallet, which a request that names none falls back to (decisions 0217
 * and 0307); `undefined` when every wallet has a role.
 */
export function defaultWalletIn(
  wallets: readonly WalletRecord[],
  owned: readonly Id<"wal">[],
): Id<"wal"> | undefined {
  const withRole = new Set(
    wallets.filter((wallet) => wallet.role !== undefined).map((wallet) => wallet.id),
  );
  return owned.find((wallet) => !withRole.has(wallet));
}

/**
 * Why a trade or an auto order may not run from the wallet its request names, before anything is
 * stored: the agent's bridge wallet makes only the deposits bridge venues mark as its own
 * (`intent.bridge_wallet_only`, decision 0307), and a live launch or bridge wallet beyond the
 * agent's wallet of that role runs nothing (`intent.extra_wallet`, decision 0218). `undefined` for
 * any other wallet, which the caller still checks is the agent's.
 */
export function namedWalletRefusal(
  wallets: readonly WalletRecord[],
  named: { readonly agent: Id<"agt">; readonly wallet: Id<"wal"> },
): ProtocolErrorCode | undefined {
  const record = wallets.find(
    (wallet) =>
      wallet.id === named.wallet &&
      wallet.agentId === named.agent &&
      wallet.archivedAtMs === undefined,
  );
  const role = record?.role;
  if (role === undefined) {
    return undefined;
  }
  if (roleWalletIn(wallets, named.agent, role)?.id !== named.wallet) {
    return "intent.extra_wallet";
  }
  return role === "bridge" ? "intent.bridge_wallet_only" : undefined;
}
