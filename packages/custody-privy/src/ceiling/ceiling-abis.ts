import type { AbiFunction, AbiParameter } from "./policy-rule.js";

function nonpayable(
  name: string,
  inputs: readonly AbiParameter[],
  outputs: readonly AbiParameter[],
): AbiFunction {
  return { type: "function", name, inputs, outputs, stateMutability: "nonpayable" };
}

const success: readonly AbiParameter[] = [{ name: "", type: "bool" }];

/** ERC-20 `approve(spender, amount)`: the ceiling reads `approve.spender`. */
export const approveAbi: AbiFunction = nonpayable(
  "approve",
  [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  success,
);

/** ERC-20 `transfer(to, amount)`: the ceiling reads `transfer.to`. */
export const transferAbi: AbiFunction = nonpayable(
  "transfer",
  [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  success,
);
