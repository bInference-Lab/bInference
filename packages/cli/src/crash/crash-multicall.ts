import { bsc } from "@binference/chains";
import type { JsonValue } from "@binference/core";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Hex,
  isAddress,
  multicall3Abi,
} from "viem";
import { z } from "zod";
import { readChainRequest } from "./crash-chain.schema.js";

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
  z.unknown().optional(),
]);

// One call of an `aggregate3`, as Multicall3 makes it: its answer, or a failure.
async function oneCall(
  anvil: AnvilCall,
  sub: { readonly target: Address; readonly callData: Hex },
): Promise<{ readonly success: boolean; readonly returnData: Hex }> {
  try {
    const answer = await anvil("eth_call", [{ to: sub.target, data: sub.callData }, "latest"]);
    return { success: true, returnData: hexSchema.parse(answer) };
  } catch {
    return { success: false, returnData: "0x" };
  }
}

// What Multicall3 would answer the call's data.
async function resultOf(anvil: AnvilCall, data: Hex): Promise<Hex> {
  const decoded = decodeFunctionData({ abi: multicall3Abi, data });
  if (decoded.functionName === "getEthBalance") {
    const [holder] = decoded.args;
    const balance = BigInt(hexSchema.parse(await anvil("eth_getBalance", [holder, "latest"])));
    return encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "getEthBalance",
      result: balance,
    });
  }
  if (decoded.functionName !== "aggregate3") {
    throw new Error(`The crash chain's Multicall3 does not answer ${decoded.functionName}.`);
  }
  const [calls] = decoded.args;
  const answers = await Promise.all(calls.map(async (sub) => oneCall(anvil, sub)));
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: answers });
}

/**
 * Answers an `eth_call` to Multicall3's address as Multicall3 would, its `aggregate3` and
 * `getEthBalance` read call by call from anvil, since the crash chain is bare and Multicall3 is
 * deployed on BSC; `undefined` for any other request, which goes on to anvil.
 */
export async function multicallAnswer(text: string, anvil: AnvilCall): Promise<string | undefined> {
  const request = readChainRequest(text);
  const call = request?.method === "eth_call" ? callSchema.safeParse(request.params) : undefined;
  if (request === undefined || call?.success !== true || multicall === undefined) {
    return undefined;
  }
  const [{ to, data }] = call.data;
  if (!isAddress(to) || getAddress(to) !== multicall) {
    return undefined;
  }
  const result = await resultOf(anvil, data);
  return JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, result });
}
