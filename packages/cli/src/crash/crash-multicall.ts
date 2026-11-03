import { bsc } from "@binference/chains";
import { type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Hex,
  isAddress,
  multicall3Abi,
  parseAbi,
} from "viem";
import { z } from "zod";
import { readChainRequest } from "./crash-chain.schema.js";
import type { StandIns, ViewAnswer, ViewCall } from "./crash-stand-ins.js";

/** Calls anvil itself, past the test's counting and kills. */
type AnvilCall = (method: string, params: readonly JsonValue[]) => Promise<JsonValue>;

const listed = bsc.contracts.find(({ venue }) => venue === "multicall3");
// Multicall3 at its address on BSC, which a bare chain lacks.
const multicall: Address | undefined =
  listed === undefined ? undefined : getAddress(listed.address);

const hexSchema = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x[0-9a-f]*$/iu.test(value),
);
const callSchema = z.tuple([
  z.looseObject({ to: z.string(), data: hexSchema }),
  jsonValueSchema.optional(),
]);
const blockSchema = z.looseObject({ number: hexSchema, timestamp: hexSchema });

/** Where one `eth_call` runs: anvil, the stand-ins, and the block it names. */
interface CallPlace {
  readonly anvil: AnvilCall;
  readonly standIns: StandIns;
  readonly block: JsonValue;
}

/** One call's answer as Multicall3's `aggregate3` gives it. */
interface SubAnswer {
  readonly success: boolean;
  readonly returnData: Hex;
}

const failed: SubAnswer = { success: false, returnData: "0x" };

// One call as anvil runs it at the call's block: its answer, or a failure.
async function anvilCall(
  place: CallPlace,
  sub: { readonly to: Address; readonly data: Hex },
): Promise<SubAnswer> {
  try {
    const answer = await place.anvil("eth_call", [{ to: sub.to, data: sub.data }, place.block]);
    return { success: true, returnData: hexSchema.parse(answer) };
  } catch {
    return failed;
  }
}

// Multicall3's own reads of a balance and of the block it runs in, as multicall3.com's ABI names
// them.
const headAbi = parseAbi([
  "function getEthBalance(address addr) view returns (uint256 balance)",
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);

// Multicall3's own read, from anvil at the call's block; `undefined` for any other call.
async function headOf(place: CallPlace, data: Hex): Promise<Hex | undefined> {
  const decoded = decodeHead(data);
  if (decoded === undefined) {
    return undefined;
  }
  if (decoded.functionName === "getEthBalance") {
    const [holder] = decoded.args;
    const balance = BigInt(
      hexSchema.parse(await place.anvil("eth_getBalance", [holder, place.block])),
    );
    return encodeFunctionResult({ abi: headAbi, functionName: "getEthBalance", result: balance });
  }
  const { functionName } = decoded;
  const block = blockSchema.parse(await place.anvil("eth_getBlockByNumber", [place.block, false]));
  const result = BigInt(functionName === "getBlockNumber" ? block.number : block.timestamp);
  return encodeFunctionResult({ abi: headAbi, functionName, result });
}

function decodeHead(data: Hex) {
  try {
    return decodeFunctionData({ abi: headAbi, data });
  } catch {
    return undefined;
  }
}

const asSub = (answer: ViewAnswer): SubAnswer =>
  answer === "revert" ? failed : { success: true, returnData: answer.data };

// One call of an `aggregate3`, as Multicall3 makes it: a stand-in's answer, Multicall3's own read,
// or anvil's.
async function oneCall(
  place: CallPlace,
  sub: { readonly target: Address; readonly callData: Hex },
): Promise<SubAnswer> {
  const call = { to: getAddress(sub.target), data: sub.callData, block: place.block };
  const standIn = await place.standIns.view(call);
  if (standIn !== undefined) {
    return asSub(standIn);
  }
  const head = call.to === multicall ? await headOf(place, call.data) : undefined;
  return head === undefined ? anvilCall(place, call) : { success: true, returnData: head };
}

// What Multicall3 would answer the call's data.
async function resultOf(place: CallPlace, data: Hex): Promise<Hex> {
  const decoded = decodeFunctionData({ abi: multicall3Abi, data });
  if (decoded.functionName !== "aggregate3") {
    const head = await headOf(place, data);
    if (head === undefined) {
      throw new Error(`The crash chain's Multicall3 does not answer ${decoded.functionName}.`);
    }
    return head;
  }
  const [calls] = decoded.args;
  const answers = await Promise.all(calls.map(async (sub) => oneCall(place, sub)));
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: answers });
}

const revertReply = { code: 3, message: "execution reverted", data: "0x" };

// A stand-in's answer to a call made to its own contract, as a node gives it; `undefined` when no
// stand-in answers for the contract.
async function standInReply(
  standIns: StandIns,
  call: ViewCall & { readonly id: JsonValue },
): Promise<string | undefined> {
  const answer = await standIns.view(call);
  if (answer === undefined) {
    return undefined;
  }
  const { id } = call;
  return JSON.stringify(
    answer === "revert"
      ? { jsonrpc: "2.0", id, error: revertReply }
      : { jsonrpc: "2.0", id, result: answer.data },
  );
}

/**
 * Answers an `eth_call` the way the bare crash chain cannot: one to Multicall3's address as
 * Multicall3 would, each call of its `aggregate3` from a stand-in or from anvil at the call's block,
 * and its own reads of that block; one to a stand-in's contract from the stand-in. Answers
 * `undefined` for any other request, which goes on to anvil.
 */
export async function multicallAnswer(
  text: string,
  calls: { readonly anvil: AnvilCall; readonly standIns: StandIns },
): Promise<string | undefined> {
  const request = readChainRequest(text);
  const call = request?.method === "eth_call" ? callSchema.safeParse(request.params) : undefined;
  if (request === undefined || call?.success !== true || !isAddress(call.data[0].to)) {
    return undefined;
  }
  const [{ data }, block = "latest"] = call.data;
  const to = getAddress(call.data[0].to);
  const id = request.id ?? null;
  if (to !== multicall) {
    return standInReply(calls.standIns, { id, to, data, block });
  }
  const result = await resultOf({ ...calls, block }, data);
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
