import type { WalletRole } from "@binference/chain";
import type { WalletView } from "@binference/protocol";
import type { CheckFinding } from "./check-finding.js";
import { connectEngine } from "./connect-engine.js";
import type { InstallCheck } from "./install-findings.js";

/** The check ids and message keys of one wallet role's findings. */
interface RoleChecks {
  readonly extra: string;
  readonly extraKey: string;
  readonly calls: string;
  readonly callsKey: string;
}

const roleChecks: Readonly<Record<WalletRole, RoleChecks>> = {
  launch: {
    extra: "wallets.extra_launch",
    extraKey: "check.extraLaunch",
    calls: "wallets.launch_calls",
    callsKey: "check.launchCalls",
  },
  bridge: {
    extra: "wallets.extra_bridge",
    extraKey: "check.extraBridge",
    calls: "wallets.bridge_calls",
    callsKey: "check.bridgeCalls",
  },
};

// The role a wallet view shows: `role` for a launch wallet, `bridge` for a bridge wallet.
function roleOfView(wallet: WalletView): WalletRole | undefined {
  return wallet.role ?? (wallet.bridge === true ? "bridge" : undefined);
}

/**
 * `wallets.extra_launch` or `wallets.extra_bridge` from the wallets the running engine lists
 * (decisions 0218 and 0307): a warning naming each live wallet of the role beyond its agent's
 * wallet of that role, as a rebuild may adopt, since nothing runs from it and the owner rescues
 * what it holds. Without an engine to ask (`undefined`), the check is skipped.
 */
export function extraRoleWalletsOf(
  wallets: readonly WalletView[] | undefined,
  role: WalletRole,
): CheckFinding {
  const { extra: check, extraKey } = roleChecks[role];
  if (wallets === undefined) {
    return { check, level: "skip" };
  }
  const extra = wallets.filter(
    (wallet) =>
      roleOfView(wallet) === role && wallet.extra === true && wallet.archivedAt === undefined,
  );
  if (extra.length === 0) {
    return { check, level: "ok" };
  }
  const addresses = extra.map((wallet) => wallet.address);
  return {
    check,
    level: "warn",
    message: { key: extraKey, values: { count: extra.length, addresses: addresses.join(", ") } },
    details: { wallets: extra.map((wallet) => wallet.wallet), addresses },
  };
}

/**
 * `wallets.launch_calls` or `wallets.bridge_calls` from the wallets the running engine lists
 * (decisions 0271 and 0307): a warning naming each agent's wallet of the role whose ceiling lacks
 * calls its venues mark as that role's, such as a create call a launchpad declared after the
 * wallet was made, with the owner key's fix. Without an engine to ask (`undefined`), the check is
 * skipped.
 */
export function roleWalletCallsOf(
  wallets: readonly WalletView[] | undefined,
  role: WalletRole,
): CheckFinding {
  const { calls: check, callsKey } = roleChecks[role];
  if (wallets === undefined) {
    return { check, level: "skip" };
  }
  const lacking = wallets.filter(
    (wallet) => roleOfView(wallet) === role && (wallet.missingCalls ?? []).length > 0,
  );
  if (lacking.length === 0) {
    return { check, level: "ok" };
  }
  const named = lacking.map(
    (wallet) => `${wallet.wallet} (${wallet.address}): ${(wallet.missingCalls ?? []).join(", ")}`,
  );
  return {
    check,
    level: "warn",
    message: { key: callsKey, values: { count: lacking.length, wallets: named.join("; ") } },
    details: {
      wallets: lacking.map((wallet) => wallet.wallet),
      calls: lacking.map((wallet) => Array.from(wallet.missingCalls ?? [])),
    },
  };
}

// Every wallet the running engine holds; none when no engine answers.
async function listedWallets(options: InstallCheck): Promise<readonly WalletView[] | undefined> {
  const connection = await connectEngine(options.host, options.signal);
  if (!connection.ok) {
    return undefined;
  }
  try {
    const page = await connection.client.call("wallet/list", {}, { signal: options.signal });
    return page.items;
  } catch {
    return undefined;
  } finally {
    connection.client.close();
  }
}

/**
 * `wallets.extra_launch`, `wallets.launch_calls`, `wallets.extra_bridge` and
 * `wallets.bridge_calls`: asks the running engine for its wallets once and judges them.
 */
export async function roleWalletFindings(options: InstallCheck): Promise<readonly CheckFinding[]> {
  const wallets = await listedWallets(options);
  const roles: readonly WalletRole[] = ["launch", "bridge"];
  return roles.flatMap((role) => [
    extraRoleWalletsOf(wallets, role),
    roleWalletCallsOf(wallets, role),
  ]);
}
