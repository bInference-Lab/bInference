import type { WalletView } from "@binference/protocol";
import type { CheckFinding } from "./check-finding.js";
import { connectEngine } from "./connect-engine.js";
import type { InstallCheck } from "./install-findings.js";

const check = "wallets.extra_launch";
const callsCheck = "wallets.launch_calls";

/**
 * `wallets.extra_launch` from the wallets the running engine lists (decision 0218): a warning
 * naming each live launch wallet beyond its agent's launch wallet, as a rebuild may adopt, since
 * nothing trades from it and the owner rescues what it holds. Without an engine to ask
 * (`undefined`), the check is skipped.
 */
export function extraLaunchOf(wallets: readonly WalletView[] | undefined): CheckFinding {
  if (wallets === undefined) {
    return { check, level: "skip" };
  }
  const extra = wallets.filter(
    (wallet) => wallet.extra === true && wallet.archivedAt === undefined,
  );
  if (extra.length === 0) {
    return { check, level: "ok" };
  }
  const addresses = extra.map((wallet) => wallet.address);
  return {
    check,
    level: "warn",
    message: {
      key: "check.extraLaunch",
      values: { count: extra.length, addresses: addresses.join(", ") },
    },
    details: { wallets: extra.map((wallet) => wallet.wallet), addresses },
  };
}

/**
 * `wallets.launch_calls` from the wallets the running engine lists (decision 0271): a warning
 * naming each agent's launch wallet whose ceiling lacks calls its launchpads need, such as a create
 * call a launchpad declared after the wallet was made, with the owner key's fix. Without an engine
 * to ask (`undefined`), the check is skipped.
 */
export function launchCallsOf(wallets: readonly WalletView[] | undefined): CheckFinding {
  if (wallets === undefined) {
    return { check: callsCheck, level: "skip" };
  }
  const lacking = wallets.filter((wallet) => (wallet.missingCalls ?? []).length > 0);
  if (lacking.length === 0) {
    return { check: callsCheck, level: "ok" };
  }
  const named = lacking.map(
    (wallet) => `${wallet.wallet} (${wallet.address}): ${(wallet.missingCalls ?? []).join(", ")}`,
  );
  return {
    check: callsCheck,
    level: "warn",
    message: {
      key: "check.launchCalls",
      values: { count: lacking.length, wallets: named.join("; ") },
    },
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
 * `wallets.extra_launch` and `wallets.launch_calls`: asks the running engine for its wallets once
 * and judges them.
 */
export async function launchWalletFindings(
  options: InstallCheck,
): Promise<readonly CheckFinding[]> {
  const wallets = await listedWallets(options);
  return [extraLaunchOf(wallets), launchCallsOf(wallets)];
}
