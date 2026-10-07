import { type Abi, decodeFunctionData, type Hex } from "viem";
import type { FakeAbiFunction } from "./fake-privy-request.schema.js";

/** A value read from calldata: a number as `bigint`, anything else as its text. */
export type CalldataValue = string | bigint;

function valueOf(arg: unknown): CalldataValue {
  return typeof arg === "bigint" ? arg : String(arg);
}

/**
 * Reads a field of calldata decoded with a condition's ABI, as Privy does: `function_name`, or
 * `<function>.<input>` by the input's name. Addresses read checksummed. Calldata the ABI cannot
 * decode, or a call to another function, has no such field.
 */
export function readCalldataField(
  abi: readonly FakeAbiFunction[],
  field: string,
  data: Hex,
): CalldataValue | undefined {
  try {
    const items: Abi = abi.map((item) => ({
      ...item,
      inputs: [...item.inputs],
      outputs: [...item.outputs],
    }));
    const decoded = decodeFunctionData({ abi: items, data });
    if (field === "function_name") {
      return decoded.functionName;
    }
    const [name, input] = field.split(".");
    const index = abi
      .find((item) => item.name === name)
      ?.inputs.findIndex((item) => item.name === input);
    const args: readonly unknown[] = decoded.args ?? [];
    return name === decoded.functionName && index !== undefined && index >= 0
      ? valueOf(args[index])
      : undefined;
  } catch {
    return undefined;
  }
}
