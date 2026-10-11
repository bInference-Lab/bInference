import { BinferenceError } from "@binference/core";
import { type CeilingHeld, isBuiltCeiling, readCeiling } from "../ceiling/read-ceiling.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { KeyQuorum, PrivyId, PrivyPolicy, WalletRecord } from "../privy/privy-records.js";
import { isSoleKey } from "./read-back.js";

/** A wallet the owner key owns alone, with its ceiling as Privy holds it now. */
export interface OwnedWallet {
  readonly wallet: WalletRecord;
  /** The key quorum of the owner key, which owns the wallet and its ceiling. */
  readonly ownerQuorum: PrivyId;
  readonly policy: PrivyPolicy;
  readonly ceiling: CeilingHeld;
}

/** Privy's largest page of wallets. */
const pageLimit = 100;
// 20 pages of 100: far more wallets than one install makes; a longer list is a fault.
const maxPages = 20;

async function listAll(
  api: PrivyApi,
  query: { readonly ownerKey: string; readonly pageSize: number },
  options: CallOptions,
): Promise<readonly WalletRecord[]> {
  const wallets: WalletRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const request = { authorizationKey: query.ownerKey, limit: query.pageSize };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page follows the cursor the one before gave
    const read = await api.listWallets(
      cursor === undefined ? request : { ...request, cursor },
      options,
    );
    wallets.push(...read.wallets);
    if (read.nextCursor === undefined) {
      return wallets;
    }
    cursor = read.nextCursor;
  }
  throw new BinferenceError({
    code: "custody.too_many_wallets",
    message: `Privy lists more than ${String(maxPages * query.pageSize)} wallets for this owner key.`,
  });
}

// The wallet's ceiling, read, when the wallet's owner owns it and it is an Ethereum policy of
// version 1.0 whose rules are exactly one `buildCeiling` builds.
function ceilingOf(policy: PrivyPolicy, wallet: WalletRecord): CeilingHeld | undefined {
  const isOurs = policy.chainType === "ethereum" && policy.version === "1.0";
  return policy.ownerId === wallet.ownerId && isOurs && isBuiltCeiling(policy.rules)
    ? readCeiling(policy.rules)
    : undefined;
}

// The wallet, owned by the owner key alone, under one ceiling the same quorum owns, which is
// exactly one `buildCeiling` builds.
async function ownedOf(
  api: PrivyApi,
  found: { readonly wallet: WalletRecord; readonly ownerKey: string },
  options: CallOptions & { readonly quorums: Map<PrivyId, KeyQuorum | undefined> },
): Promise<OwnedWallet | undefined> {
  const { wallet, ownerKey } = found;
  const [policyId, ...more] = wallet.policyIds;
  if (wallet.ownerId === null || policyId === undefined || more.length > 0) {
    return undefined;
  }
  if (!options.quorums.has(wallet.ownerId)) {
    const quorum = await api.keyQuorum(wallet.ownerId, options);
    options.quorums.set(wallet.ownerId, quorum.ok ? quorum.value : undefined);
  }
  const policy = await api.policy(policyId, options);
  if (!policy.ok || !isSoleKey(options.quorums.get(wallet.ownerId), ownerKey)) {
    return undefined;
  }
  const ceiling = ceilingOf(policy.value, wallet);
  return ceiling === undefined
    ? undefined
    : { wallet, ownerQuorum: wallet.ownerId, policy: policy.value, ceiling };
}

/**
 * The app's Ethereum wallets the owner key owns, for an install rebuilt on a new machine
 * (decision 0142): Privy lists those whose owner holds the key, a page at a time, and a wallet
 * counts only when the owner key alone owns it and its one ceiling, whose rules must be exactly
 * one `buildCeiling` builds, with its token sends paying the addresses its native sends pay.
 * Oldest first, as Privy lists them. More than 2,000 wallets is a fault.
 */
export async function findOwnedWallets(
  api: PrivyApi,
  query: { readonly ownerKey: string; readonly pageSize?: number },
  options: CallOptions,
): Promise<readonly OwnedWallet[]> {
  const pageSize = query.pageSize ?? pageLimit;
  const listed = await listAll(api, { ownerKey: query.ownerKey, pageSize }, options);
  const quorums = new Map<PrivyId, KeyQuorum | undefined>();
  const owned: OwnedWallet[] = [];
  for (const wallet of listed) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet at a time, as Privy's limits ask
    const found = await ownedOf(api, { wallet, ownerKey: query.ownerKey }, { ...options, quorums });
    if (found !== undefined) {
      owned.push(found);
    }
  }
  return owned;
}
