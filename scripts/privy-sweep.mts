import process from "node:process";
import { createSecret } from "@binference/core";
import {
  createLeftoverBook,
  leftoverKeychainService,
  liveHttps,
  realClock,
  sweepLeftovers,
} from "@binference/custody-privy/testing";
import { createKeychainSecretStore } from "@binference/platform";

// Removes what live runs of the custody suite left on the Privy test app, with the owner keys the
// OS keychain keeps for them: each wallet those keys own lets its policies go, then the policies,
// the 24-hour caps' aggregations and the empty key quorums are deleted, each signed by its owner
// key. A record and its key leave the keychain once every policy and aggregation it names is gone.
// The test app's id and secret come from the environment and are never printed. Test app only:
//
//   BINFERENCE_PRIVY_APP_ID=... BINFERENCE_PRIVY_APP_SECRET=... pnpm privy:sweep [--dry-run]
//
// --dry-run reads what Privy still holds and counts what the sweep would remove, removing nothing.

const usage =
  "Usage: pnpm privy:sweep [--dry-run], with the Privy test app's id and secret in " +
  "BINFERENCE_PRIVY_APP_ID and BINFERENCE_PRIVY_APP_SECRET.";

// A sweep sends one request at a time, each within 30 seconds.
const sweepTimeoutMs = 600_000;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const appId = process.env["BINFERENCE_PRIVY_APP_ID"] ?? "";
  const secret = process.env["BINFERENCE_PRIVY_APP_SECRET"] ?? "";
  if (appId === "" || secret === "" || args.some((arg) => arg !== "--dry-run")) {
    console.error(usage);
    return 1;
  }
  const isDryRun = args.includes("--dry-run");
  const counts = await sweepLeftovers(
    {
      privy: {
        http: liveHttps,
        clock: realClock,
        appId,
        appSecret: createSecret(secret),
        timeoutMs: 30_000,
      },
      book: createLeftoverBook(createKeychainSecretStore({ service: leftoverKeychainService })),
      isDryRun,
    },
    AbortSignal.timeout(sweepTimeoutMs),
  );
  const verb = isDryRun ? "would remove" : "removed";
  console.log(
    [
      `privy:sweep read ${String(counts.records)} kept records and ${verb}:`,
      `  wallets detached from their policies: ${String(counts.walletsDetached)}`,
      `  policies: ${String(counts.policiesDeleted)}`,
      `  aggregations: ${String(counts.aggregationsDeleted)}`,
      `  key quorums: ${String(counts.quorumsDeleted)}`,
      `Privy kept ${String(counts.quorumsKept)} key quorums that still own a wallet, and ` +
        `${String(counts.othersKept)} policies or aggregations.`,
      `Records cleared with their keys: ${String(counts.recordsCleared)}.`,
    ].join("\n"),
  );
  return counts.othersKept === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`privy:sweep stopped: ${reason} The kept records stay for the next sweep.`);
  process.exitCode = 1;
}
