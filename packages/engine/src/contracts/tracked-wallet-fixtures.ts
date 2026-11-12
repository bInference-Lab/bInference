import assert from "node:assert/strict";
import {
  type AccountRef,
  type AssetRef,
  assetRefParts,
  type ChainRef,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { testCoin } from "../intents/test-intents.js";
import type { LeaderReadRecord, WalletActivity } from "../leaders/tracked-wallet-record.js";
import { alertOf, priceAsset, walletCondition } from "./alert-fire-checks.js";
import { live } from "./store-fixtures.js";
import type { TrackedWalletSubject } from "./tracked-wallet-store-contract.js";

// The tracked wallet checks' fixtures: the alert checks' token and accounts, on the test chain.

const token: AssetRef = priceAsset;
const coin: AssetRef = testCoin;
/** The chain the fixture accounts and trades are on. */
export const chain: ChainRef = assetRefParts(token).chain;
/** A chain nothing is on. */
export const other: ChainRef = chainRefSchema.parse("fake:2");

/** The account of fixture wallet `n`. */
export function accountOf(n: number): AccountRef {
  const condition = walletCondition(n);
  return condition.kind === "wallet" ? condition.account : assert.fail("no wallet condition");
}

function txOf(n: number): TxHash {
  const hash = `0x${n.toString(16).padStart(64, "0")}`;
  return isTxHash(hash) ? hash : assert.fail("not a hash");
}

/** A sale of wallet `n` at `block`, at `block` seconds, its amount past 64 bits. */
export function saleOf(n: number, block: number, logIndex = 0): WalletActivity {
  return {
    account: accountOf(n),
    block: BigInt(block),
    txHash: txOf(block),
    logIndex,
    side: "sell",
    asset: token,
    amount: 2n ** 64n + 1n,
    counterAsset: coin,
    counterAmount: 3n,
    valueUsdMicros: 7n,
    shareSoldBps: bpsSchema.parse(4_000),
    venue: "test-venue",
    atMs: block * 1_000,
  };
}

/** A read of blocks `from` to `to`, block `n` at `n` seconds, of wallet 1 from `from`. */
export function readOf(
  span: readonly [number, number],
  extra: Partial<Omit<LeaderReadRecord, "from" | "to">> = {},
): LeaderReadRecord {
  const [from, to] = span.map((block) => BigInt(block));
  return {
    chain,
    from: from ?? 0n,
    to: to ?? 0n,
    toHash: `0x${span[1].toString(16).padStart(64, "0")}`,
    atMs: span[1] * 1_000,
    wallets: [{ account: accountOf(1), sinceBlock: from ?? 0n, readFrom: from ?? 0n }],
    trades: [],
    overflows: [],
    ...extra,
  };
}

/** Tracks wallet `n` through alert `alert` of the subject's first agent. */
export async function track(
  subject: TrackedWalletSubject,
  n: number,
  alert: number = n,
): Promise<void> {
  const created = await subject.alerts.create(
    alertOf(subject, alert, { condition: walletCondition(n) }),
    live(),
  );
  assert.equal(created.ok, true);
}
