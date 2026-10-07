import type { Id } from "@binference/core";
import type { WalletRecord } from "./install-record.js";

/** What a test names of a wallet; the rest of the record follows from its id. */
export interface TestWallet {
  readonly id: Id<"wal">;
  readonly agentId: Id<"agt">;
  readonly label: string;
  readonly createdAtMs: number;
  readonly archivedAtMs?: number;
}

/**
 * A wallet record as setting up an install stores it, for tests: held in Privy on the fake chain
 * family, with Privy ids and an address made from the wallet's id.
 */
export function testWalletRecord(wallet: TestWallet): WalletRecord {
  const tag = wallet.id.slice(-12);
  return {
    ...wallet,
    family: "fake",
    custody: "privy",
    custodyWalletId: `privy-wallet-${tag}`,
    policyId: `privy-policy-${tag}`,
    signerId: "privy-agent-quorum",
    address: `0x${tag.slice(-8)}`,
    ceiling: {
      policyId: `privy-policy-${tag}`,
      policy: [],
      perTxNativeBase: 10n ** 18n,
      readAtMs: wallet.createdAtMs,
    },
  };
}
