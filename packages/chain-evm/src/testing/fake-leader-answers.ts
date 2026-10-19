import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  getAddress,
  type Hex,
  multicall3Abi,
  pad,
  parseAbi,
  toFunctionSelector,
  toHex,
} from "viem";
import { z } from "zod";
import { transferTopic } from "../leaders/wallet-transfers.js";
import { addressSchema, hexSchema } from "../rpc/evm-wire.schema.js";
import type { JsonValue } from "../rpc/json-value.schema.js";
import type { FakeRpcAnswer } from "./fake-rpc-http.js";

/** One ERC-20 transfer a fake transaction logs. */
interface FakeTransfer {
  readonly token: Address;
  readonly from: Address;
  readonly to: Address;
  readonly value: bigint;
}

/** A transaction of a fake chain: its sender, target, value, logs and the coin it pays inside. */
export interface FakeTx {
  readonly from: Address;
  readonly to?: Address;
  readonly value?: bigint;
  readonly transfers?: readonly FakeTransfer[];
  /** Native coin a contract sends from inside the call, which no log shows. */
  readonly pays?: readonly { readonly to: Address; readonly value: bigint }[];
  readonly fee?: bigint;
  /** Other logs it writes after its transfers, such as a launchpad's events. */
  readonly logs?: readonly FakeLog[];
}

/** A log a fake transaction writes besides its transfers. */
export interface FakeLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

/** A fake chain's answer to a read call of a contract, or `undefined` for a revert. */
export type FakeRead = (target: Address, callData: Hex) => Hex | undefined;

/** A mined transaction of a fake chain, every field filled. */
export interface MinedTx {
  readonly hash: Hex;
  readonly from: Address;
  readonly to?: Address;
  readonly value: bigint;
  readonly transfers: readonly FakeTransfer[];
  readonly pays: readonly { readonly to: Address; readonly value: bigint }[];
  readonly fee: bigint;
  readonly logs: readonly FakeLog[];
}

/** A mined block of a fake chain. */
export interface FakeBlock {
  readonly number: bigint;
  readonly hash: Hex;
  readonly parentHash: Hex;
  readonly txs: readonly MinedTx[];
}

/** What a fake chain holds. */
export interface FakeChainState {
  readonly blocks: FakeBlock[];
  readonly start: bigint;
  readonly multicall: Address;
  readonly holdings: readonly {
    readonly account: Address;
    readonly token: Address;
    readonly value: bigint;
  }[];
  readonly maxLogs: number;
  /** Answers the read calls of a Multicall3 batch other than an ERC-20 `balanceOf`. */
  readonly reads?: FakeRead;
  generation: number;
  prunedBelow: bigint;
}

type Answer = (params: readonly JsonValue[]) => FakeRpcAnswer;

const timeAtZero = 1_800_000_000n;
const startingCoin = 10n ** 21n;
const missing: FakeRpcAnswer = { error: { code: -32_000, message: "missing trie node 7f3a" } };
const topicSchema = z.union([hexSchema, z.array(hexSchema), z.null()]);
const filterSchema = z.looseObject({
  fromBlock: hexSchema.optional(),
  toBlock: hexSchema.optional(),
  blockHash: hexSchema.optional(),
  topics: z.array(topicSchema),
});
const callSchema = z.looseObject({ to: addressSchema, data: hexSchema });
const balanceOfAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);
const aggregateAbi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "function aggregate3(Call3[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

function blocksUpTo(state: FakeChainState, at: bigint): readonly FakeBlock[] {
  return state.blocks.filter((block) => block.number <= at);
}

function tokenBalance(
  state: FakeChainState,
  holding: { readonly account: Address; readonly token: Address },
  at: bigint,
): bigint {
  const { account, token } = holding;
  const start = state.holdings
    .filter((item) => item.account === account && item.token === token)
    .reduce((sum, item) => sum + item.value, 0n);
  return blocksUpTo(state, at)
    .flatMap((block) => block.txs.flatMap((tx) => tx.transfers))
    .filter((transfer) => transfer.token === token)
    .reduce((sum, { from, to, value }) => {
      const into = to === account ? value : 0n;
      return sum + into - (from === account ? value : 0n);
    }, start);
}

function coinBalance(state: FakeChainState, account: Address, at: bigint): bigint {
  return blocksUpTo(state, at)
    .flatMap((block) => block.txs)
    .reduce((sum, tx) => {
      const sent = tx.from === account ? tx.value + tx.fee : 0n;
      const paid = tx.pays
        .filter((pay) => pay.to === account)
        .reduce((all, pay) => all + pay.value, 0n);
      return sum - sent + paid;
    }, startingCoin);
}

// A transaction's transfer logs, then its other logs.
function txLogs(tx: MinedTx): readonly FakeLog[] {
  const transfers = tx.transfers.map((transfer): FakeLog => ({
    address: transfer.token,
    topics: [transferTopic, pad(transfer.from, { size: 32 }), pad(transfer.to, { size: 32 })].map(
      (topic) => hexSchema.parse(topic.toLowerCase()),
    ),
    data: pad(toHex(transfer.value), { size: 32 }),
  }));
  return [...transfers, ...tx.logs];
}

function logsOf(block: FakeBlock): readonly { readonly [key: string]: JsonValue }[] {
  let logIndex = 0;
  return block.txs.flatMap((tx) =>
    txLogs(tx).map((log) => ({
      address: log.address,
      topics: [...log.topics],
      data: log.data,
      blockNumber: toHex(block.number),
      blockHash: block.hash,
      transactionHash: tx.hash,
      logIndex: toHex(logIndex++),
      removed: false,
    })),
  );
}

function matches(position: z.infer<typeof topicSchema> | undefined, topic: JsonValue): boolean {
  if (position === null || position === undefined) {
    return true;
  }
  return typeof position === "string"
    ? position === topic
    : position.some((each) => each === topic);
}

// The final block is two below the head.
function blockOfTag(state: FakeChainState, tag: JsonValue | undefined): FakeBlock | undefined {
  return tag === "finalized"
    ? state.blocks.at(-3)
    : state.blocks.find((block) => block.number === BigInt(hexSchema.parse(tag)));
}

// The block a tag names: `latest` is the head.
function blockAt(state: FakeChainState, tag: JsonValue | undefined): bigint {
  return tag === "latest"
    ? (state.blocks.at(-1)?.number ?? state.start)
    : BigInt(hexSchema.parse(tag));
}

function isPruned(state: FakeChainState, tag: JsonValue | undefined): boolean {
  return blockAt(state, tag) < state.prunedBelow;
}

function blockAnswer(state: FakeChainState): Answer {
  return ([tag, isFull]) => {
    const block = blockOfTag(state, tag);
    if (block === undefined) {
      return { result: null };
    }
    const transactions = block.txs.map((tx) =>
      isFull === true
        ? { hash: tx.hash, from: tx.from, to: tx.to ?? null, value: toHex(tx.value) }
        : tx.hash,
    );
    const { number, hash, parentHash } = block;
    const timestamp = toHex(timeAtZero + number);
    return { result: { number: toHex(number), hash, parentHash, timestamp, transactions } };
  };
}

function logsAnswer(state: FakeChainState): Answer {
  return ([given]) => {
    const filter = filterSchema.parse(given);
    const [first, second, third] = filter.topics;
    const from = BigInt(filter.fromBlock ?? "0x0");
    const to = BigInt(filter.toBlock ?? "0x0");
    const chosen =
      filter.blockHash === undefined
        ? state.blocks.filter((block) => block.number >= from && block.number <= to)
        : state.blocks.filter((block) => block.hash === filter.blockHash);
    if (filter.blockHash !== undefined && chosen.length === 0) {
      return { error: { code: -32_000, message: "unknown block" } };
    }
    const logs = chosen.flatMap(logsOf).filter((log) => {
      const topics = z.array(z.string()).parse(log["topics"]);
      const [zero, one, two] = topics;
      return matches(first, zero ?? "") && matches(second, one ?? "") && matches(third, two ?? "");
    });
    const limit = String(state.maxLogs);
    return logs.length > state.maxLogs
      ? { error: { code: -32_005, message: `query returned more than ${limit} results` } }
      : { result: logs };
  };
}

const balanceOfSelector = toFunctionSelector(getAbiItem({ abi: balanceOfAbi, name: "balanceOf" }));

function balanceRead(state: FakeChainState, at: bigint) {
  return ({ target, callData }: { readonly target: Address; readonly callData: Hex }) => {
    if (!callData.startsWith(balanceOfSelector)) {
      const answer = state.reads?.(getAddress(target), callData);
      return { success: answer !== undefined, returnData: answer ?? "0x" };
    }
    const read = decodeFunctionData({ abi: balanceOfAbi, data: callData });
    const [account] = read.args;
    const holding = { account: getAddress(account), token: getAddress(target) };
    return { success: true, returnData: pad(toHex(tokenBalance(state, holding, at))) };
  };
}

function callAnswer(state: FakeChainState): Answer {
  return ([given, tag]) => {
    const call = callSchema.parse(given);
    if (isPruned(state, tag)) {
      return missing;
    }
    if (call.to !== state.multicall) {
      return { error: { code: 3, message: "execution reverted" } };
    }
    const decoded = decodeFunctionData({ abi: aggregateAbi, data: call.data });
    const result = decoded.args[0].map(balanceRead(state, blockAt(state, tag)));
    return {
      result: encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result }),
    };
  };
}

function txOf(state: FakeChainState, hash: JsonValue | undefined): MinedTx {
  const tx = state.blocks.flatMap((block) => block.txs).find((each) => each.hash === hash);
  if (tx === undefined) {
    throw new Error("The fake chain holds no such transaction.");
  }
  return tx;
}

/** The JSON-RPC methods a fake leader chain answers, by name. */
export function fakeLeaderAnswers(state: FakeChainState): Readonly<Record<string, Answer>> {
  return {
    eth_blockNumber: () => ({ result: toHex(state.blocks.at(-1)?.number ?? state.start) }),
    eth_getBlockByNumber: blockAnswer(state),
    eth_getLogs: logsAnswer(state),
    eth_getBalance: ([account, tag]) => {
      const at = BigInt(hexSchema.parse(tag));
      const balance = coinBalance(state, addressSchema.parse(account), at);
      return isPruned(state, tag) ? missing : { result: toHex(balance) };
    },
    eth_getTransactionReceipt: ([hash]) => {
      const { fee } = txOf(state, hash);
      return { result: { status: "0x1", gasUsed: toHex(fee), effectiveGasPrice: "0x1" } };
    },
    eth_call: callAnswer(state),
    debug_traceTransaction: ([hash]) => {
      const tx = txOf(state, hash);
      const calls = tx.pays.map((pay) => ({ to: pay.to, value: toHex(pay.value) }));
      return { result: { value: toHex(tx.value), calls } };
    },
  };
}
