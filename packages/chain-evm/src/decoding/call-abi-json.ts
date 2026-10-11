import type { JsonValue } from "@binference/core";
import type { AbiFunction, AbiParameter } from "viem";

function parameterJson(parameter: AbiParameter): JsonValue {
  const components = "components" in parameter ? parameter.components : undefined;
  return {
    name: parameter.name ?? "",
    type: parameter.type,
    ...(components === undefined ? {} : { components: components.map(parameterJson) }),
  };
}

/**
 * One function of a contract's ABI as plain JSON, such as a venue declares the functions its
 * transactions call: its name, its inputs and outputs with their names, types and tuple
 * components, and its state mutability. Internal type names are left out.
 */
export function callAbiJson(item: AbiFunction): JsonValue {
  return {
    type: "function",
    name: item.name,
    inputs: item.inputs.map(parameterJson),
    outputs: item.outputs.map(parameterJson),
    stateMutability: item.stateMutability,
  };
}
