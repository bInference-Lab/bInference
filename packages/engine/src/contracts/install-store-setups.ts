import { accountRefSchema } from "@binference/chain";
import type { Id } from "@binference/core";
import type { InstallSetup, WalletDraft } from "../install/install-record.js";
import type { InstallStore } from "../ports.js";
import { fixtureId } from "./store-fixtures.js";

/** An install store under test, an agent its wallets may belong to, and a family it takes. */
export interface InstallStoreSubject {
  readonly store: InstallStore;
  readonly agent: Id<"agt">;
  /** A chain family the store's wallets may have. */
  readonly family: string;
}

/** Makes a fresh install store, with no install id, custody or wallet, for each check. */
export interface InstallStoreHarness {
  create(): Promise<InstallStoreSubject>;
}

// 2^64 + 1 does not fit a SQLite integer: the cap must round-trip as decimal text.
const beyond64Bits = 2n ** 64n + 1n;

/** A wallet draft of the subject's agent and family, numbered `n`. */
export function wallet(subject: InstallStoreSubject, n: number): WalletDraft {
  return {
    id: fixtureId("wal", n),
    agentId: subject.agent,
    family: subject.family,
    custody: "privy",
    custodyWalletId: `privy-wallet-${String(n)}`,
    policyId: `privy-policy-${String(n)}`,
    signerId: "privy-agent-quorum",
    address: `0x${n.toString(16).padStart(40, "a")}`,
    label: `wallet ${String(n)}`,
    createdAtMs: 1_000 * n,
    ceiling: {
      policyId: `privy-policy-${String(n)}`,
      policy: [{ name: "Contract calls", action: "ALLOW" }],
      perTxNativeBase: beyond64Bits + BigInt(n),
      readAtMs: 1_000 * n + 1,
    },
  };
}

/** The setup numbered `n`: its custody, its rescue address and its first wallet. */
export function setup(subject: InstallStoreSubject, n: number, isStartOver = false): InstallSetup {
  return {
    atMs: 1_000 * n,
    custody: {
      provider: "privy",
      appId: `app-${String(n)}`,
      ownerQuorumId: `owner-quorum-${String(n)}`,
      ownerKeyPublic: "b3duZXIga2V5",
      agentQuorumId: "privy-agent-quorum",
      agentKeyPublic: "YWdlbnQga2V5",
      attachedAtMs: 1_000 * n,
    },
    rescueAddress: accountRefSchema.parse(`fake:1:0x${String(n).repeat(40).slice(0, 40)}`),
    wallet: wallet(subject, n),
    isStartOver,
  };
}
