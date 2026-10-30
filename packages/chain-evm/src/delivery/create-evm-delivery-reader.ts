import {
  type Amount,
  type AssetRef,
  type Delivery,
  type DeliveryReader,
  type DeliveryRequest,
  type ReceiptReader,
  type TxReceipt,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { Address } from "viem";
import { readEvmBalances } from "../balances/read-balances.js";
import type { EvmChain } from "../evm-chain.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { accountAddressOn } from "../sending/account-address-on.js";
import { aggregatorTokenOf } from "../tokens/aggregator-token.js";

/** What the EVM delivery reader reads one chain through. */
export interface EvmDeliveryReaderOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
  /** The chain's receipt reader, over the same failover. */
  readonly receipts: ReceiptReader;
  /** Multicall3 on the chain, which reads a token's balance. */
  readonly multicall: Address;
}

/** One delivery read: the reader's parts, what it asks, and its signal. */
interface DeliveryRead {
  readonly options: EvmDeliveryReaderOptions;
  readonly request: DeliveryRequest;
  readonly signal: AbortSignal;
}

// The sum of a token's transfers to the recipient less those from it: a holding that shrank
// reads as 0.
async function tokenReceived({ options, request, signal }: DeliveryRead): Promise<bigint> {
  const { receipts, chain } = options;
  const transfers = (await receipts.transfers(chain.ref, request.hash, { signal })) ?? [];
  const net = transfers
    .filter(({ amount }) => amount.asset === request.asset)
    .reduce((sum, { from, to, amount }) => {
      const gained = to === request.recipient ? amount.base : 0n;
      const spent = from === request.recipient ? amount.base : 0n;
      return sum + gained - spent;
    }, 0n);
  return net > 0n ? net : 0n;
}

// An inner call's value leaves no log, as a bridge that unwraps the coin for the recipient sends
// it, so the coin is read as the recipient's balance change across the block (decision 0108).
async function nativeReceived(read: DeliveryRead, block: bigint): Promise<bigint> {
  const { options, request, signal } = read;
  const received = await options.receipts.nativeReceived(request.recipient, block, { signal });
  if (!received.ok) {
    throw new BinferenceError({
      code: "chain.state_missing",
      message: `No RPC endpoint still holds the state of the ${options.chain.name} block a delivery landed in.`,
      details: { block: block.toString() },
    });
  }
  return received.value > 0n ? received.value : 0n;
}

async function receivedOf(read: DeliveryRead, receipt: TxReceipt): Promise<Amount> {
  const { options, request } = read;
  if (receipt.status === "reverted") {
    return { asset: request.asset, base: 0n };
  }
  const base =
    request.asset === options.chain.nativeAsset
      ? await nativeReceived(read, receipt.block.number)
      : await tokenReceived(read);
  return { asset: request.asset, base };
}

// A delivery is read in the chain's coin or one of its ERC-20 tokens only.
function checkAsset(chain: EvmChain, asset: AssetRef): void {
  if (
    aggregatorTokenOf(asset, { chain: chain.ref, nativeAsset: chain.nativeAsset }) === undefined
  ) {
    throw new BinferenceError({
      code: "chain.unknown_chain",
      message: `This reader reads ${chain.name}'s coin and tokens only.`,
      details: { asset },
    });
  }
}

async function readDelivery(read: DeliveryRead): Promise<Delivery | undefined> {
  const { options, request, signal } = read;
  const { chain, receipts } = options;
  accountAddressOn(chain, request.recipient);
  checkAsset(chain, request.asset);
  const receipt = await receipts.receipt(chain.ref, request.hash, { signal });
  if (receipt === undefined) {
    return undefined;
  }
  const head = await receipts.head(chain.ref, { signal });
  return {
    hash: receipt.hash,
    block: receipt.block.number,
    final: receipt.block.number <= head.final,
    status: receipt.status === "success" ? "success" : "failed",
    received: await receivedOf(read, receipt),
  };
}

/**
 * Creates the `DeliveryReader` of one EVM chain. A token's balance is its `balanceOf` through
 * Multicall3, the coin's `eth_getBalance`. A delivery is read from the transaction's receipt: a
 * token's as the sum of its `Transfer` logs to the recipient less those from it; the coin's as the
 * recipient's balance change across the block, since an inner call's value leaves no log; a
 * reverted one as 0. It is final once the chain's final block holds it. An account or an asset of
 * another chain is a fault, and a block whose state every node pruned is `chain.state_missing`.
 */
export function createEvmDeliveryReader(options: EvmDeliveryReaderOptions): DeliveryReader {
  const { rpc, chain, multicall } = options;
  return {
    chain: chain.ref,
    async balance(account, asset, { signal }) {
      signal.throwIfAborted();
      const holder = accountAddressOn(chain, account);
      const assets = [asset];
      const [amount] = await readEvmBalances(rpc, { chain, holder, assets, multicall, signal });
      return amount?.base ?? 0n;
    },
    async delivery(request, { signal }) {
      signal.throwIfAborted();
      return readDelivery({ options, request, signal });
    },
  };
}
