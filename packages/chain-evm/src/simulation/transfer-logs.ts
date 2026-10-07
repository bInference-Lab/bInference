import type { AssetApproval, AssetRef, AssetTransfer } from "@binference/chain";
import { type Address, getAddress, type Hex, toEventSelector } from "viem";
import { type EvmChain, erc20AssetRef, evmAccountRef } from "../evm-chain.js";
import type { EvmLog } from "./simulation-reply.schema.js";

const transferTopic = toEventSelector("Transfer(address,address,uint256)");
const approvalTopic = toEventSelector("Approval(address,address,uint256)");

// With traceTransfers, eth_simulateV1 reports each native transfer as an ERC-20 Transfer log
// emitted by this address (the Ethereum execution-apis spec of eth_simulateV1).
const nativeEmitter = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

const addressTopic = /^0x0{24}[0-9a-fA-F]{40}$/;
const wordData = /^0x[0-9a-fA-F]{64}$/;

interface ValueLog {
  readonly asset: AssetRef;
  readonly first: Address;
  readonly second: Address;
  readonly base: bigint;
}

function addressIn(topic: Hex): Address {
  return getAddress(`0x${topic.slice(26)}`);
}

// An ERC-20 Transfer or Approval: the signature, two indexed addresses and the value as data. An
// ERC-721 Transfer indexes its token id as a fourth topic and is left among the raw logs.
function readValueLog(chain: EvmChain, log: EvmLog, topic: Hex): ValueLog | undefined {
  const [signature, first, second, ...extra] = log.topics;
  if (signature !== topic || first === undefined || second === undefined || extra.length > 0) {
    return undefined;
  }
  if (!addressTopic.test(first) || !addressTopic.test(second) || !wordData.test(log.data)) {
    return undefined;
  }
  const native = log.address.toLowerCase() === nativeEmitter;
  return {
    asset: native ? chain.nativeAsset : erc20AssetRef(chain, log.address),
    first: addressIn(first),
    second: addressIn(second),
    base: BigInt(log.data),
  };
}

function valueLogs(chain: EvmChain, logs: readonly EvmLog[], topic: Hex): readonly ValueLog[] {
  return logs.flatMap((log) => readValueLog(chain, log, topic) ?? []);
}

/** The native and ERC-20 transfers among a simulated call's logs, in their order. */
export function readTransfers(chain: EvmChain, logs: readonly EvmLog[]): readonly AssetTransfer[] {
  return valueLogs(chain, logs, transferTopic).map((log) => ({
    from: evmAccountRef(chain, log.first),
    to: evmAccountRef(chain, log.second),
    amount: { asset: log.asset, base: log.base },
  }));
}

/** The ERC-20 approvals among a simulated call's logs, in their order. */
export function readApprovals(chain: EvmChain, logs: readonly EvmLog[]): readonly AssetApproval[] {
  return valueLogs(chain, logs, approvalTopic).map((log) => ({
    owner: evmAccountRef(chain, log.first),
    spender: evmAccountRef(chain, log.second),
    amount: { asset: log.asset, base: log.base },
  }));
}
