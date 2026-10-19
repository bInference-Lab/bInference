import type { TxHash } from "@binference/chain";
import { type Address, getAddress, type Hex, toEventSelector } from "viem";
import type { ChainLog } from "./chain-block.schema.js";

/** The topic of an ERC-20 `Transfer`, the first topic of every log the leader watcher reads. */
export const transferTopic: Hex = toEventSelector("Transfer(address,address,uint256)");

/** One ERC-20 transfer into or out of a tracked wallet. */
export interface WalletTransfer {
  readonly account: Address;
  readonly block: bigint;
  readonly txHash: TxHash;
  readonly logIndex: number;
  readonly token: Address;
  /** Base units: above 0 into the wallet, below 0 out of it. */
  readonly delta: bigint;
}

/** A wallet's block the budget cut: none of its trades there are read. */
export interface WalletOverflow {
  readonly account: Address;
  readonly block: bigint;
  /** Its transfers in the block, when the endpoint answered them; absent when it refused them. */
  readonly transfers?: number;
}

/** The logs of a span: transfers out of the tracked wallets, and transfers into them. */
export interface SpanLogs {
  readonly sent: readonly ChainLog[];
  readonly received: readonly ChainLog[];
}

const addressTopic = /^0x0{24}[0-9a-fA-F]{40}$/;
const wordData = /^0x[0-9a-fA-F]{64}$/;

// An ERC-20 Transfer: two indexed addresses and the value as data. An ERC-721 Transfer indexes
// its token id as a fourth topic, and is no transfer of value here.
function readTransfer(
  log: ChainLog,
): { readonly from: Address; readonly to: Address; readonly value: bigint } | undefined {
  const [signature, from, to, ...extra] = log.topics;
  const isTransfer = signature === transferTopic && extra.length === 0;
  if (!isTransfer || log.removed || from === undefined || to === undefined) {
    return undefined;
  }
  if (!addressTopic.test(from) || !addressTopic.test(to) || !wordData.test(log.data)) {
    return undefined;
  }
  return {
    from: getAddress(`0x${from.slice(26)}`),
    to: getAddress(`0x${to.slice(26)}`),
    value: BigInt(log.data),
  };
}

function transfersOf(
  logs: readonly ChainLog[],
  side: "sent" | "received",
  tracked: ReadonlySet<Address>,
): readonly WalletTransfer[] {
  return logs.flatMap((log) => {
    const read = readTransfer(log);
    const account = side === "sent" ? read?.from : read?.to;
    if (read === undefined || account === undefined || !tracked.has(account)) {
      return [];
    }
    const { blockNumber: block, transactionHash: txHash, logIndex, address: token } = log;
    const delta = side === "sent" ? -read.value : read.value;
    return [{ account, block, txHash, logIndex, token, delta }];
  });
}

// Block order, then log order.
function byPlace(first: WalletTransfer, second: WalletTransfer): number {
  if (first.block !== second.block) {
    return first.block < second.block ? -1 : 1;
  }
  return first.logIndex - second.logIndex;
}

function keyOf(transfer: Pick<WalletTransfer, "account" | "block">): string {
  return `${transfer.account}@${transfer.block.toString()}`;
}

/**
 * The tracked wallets' transfers in a span's logs, in block and log order, with each wallet's
 * blocks the budget cut (decision 0250): a wallet with more than `maxPerBlock` transfers in one
 * block keeps none of them there. A transfer between two tracked wallets counts for both.
 */
export function walletTransfersOf(
  logs: SpanLogs,
  tracked: ReadonlySet<Address>,
  maxPerBlock: number,
): {
  readonly transfers: readonly WalletTransfer[];
  readonly overflows: readonly WalletOverflow[];
} {
  const all = [
    ...transfersOf(logs.sent, "sent", tracked),
    ...transfersOf(logs.received, "received", tracked),
  ];
  const byWalletBlock = new Map<string, WalletTransfer[]>();
  for (const transfer of all) {
    const group = byWalletBlock.get(keyOf(transfer));
    if (group === undefined) {
      byWalletBlock.set(keyOf(transfer), [transfer]);
    } else {
      group.push(transfer);
    }
  }
  const groups = [...byWalletBlock.values()];
  const kept = groups.filter((group) => group.length <= maxPerBlock).flat();
  const overflows = groups.flatMap((group) => {
    const [first] = group;
    return group.length > maxPerBlock && first !== undefined
      ? [{ account: first.account, block: first.block, transfers: group.length }]
      : [];
  });
  const ordered = kept.toSorted(byPlace);
  return { transfers: ordered, overflows };
}
