import { type AccountRef, accountRefSchema, type TxDraft } from "@binference/plugin-sdk";
import { encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { concatHex, encodeFunctionData, type Hex, parseAbi } from "viem";
import { slisBnbAddress, stakeManagerAddress } from "./lista-world.js";

// The stake manager's siblings of the three moves, which name another account, take an index, or
// skip the queue, from `ListaStakeManager.sol`.
const siblingsAbi = parseAbi([
  "function deposit() payable",
  "function requestWithdraw(uint256 _amountInSlisBnb)",
  "function claimWithdraw(uint256 _idx)",
  "function claimWithdrawFor(address _user, uint256 _idx)",
  "function claimWithdrawByUUID(uint256 _uuid)",
  "function instantWithdraw(uint256 _amountInSlisBnb)",
]);

const other = "0x00000000000000000000000000000000000000E9";

/**
 * Drafts from the wallet that the Lista venue never builds: a sibling that names another account,
 * claims by index or skips the queue; a move to another contract; coin sent with a request or a
 * claim; a deposit with no coin; an empty request; bytes after the arguments.
 */
export function listaForeignDrafts(wallet: AccountRef): readonly TxDraft[] {
  const manager = accountRefSchema.parse(`eip155:56:${stakeManagerAddress}`);
  const elsewhere = accountRefSchema.parse(`eip155:56:${slisBnbAddress}`);
  const draft = (data: Hex, value = 0n, to = manager) =>
    encodeEvmDraft({ from: wallet, to, value, data });
  const encode = encodeFunctionData;
  return [
    draft(encode({ abi: siblingsAbi, functionName: "claimWithdraw", args: [0n] })),
    draft(encode({ abi: siblingsAbi, functionName: "claimWithdrawFor", args: [other, 0n] })),
    draft(encode({ abi: siblingsAbi, functionName: "instantWithdraw", args: [5n] })),
    draft(encode({ abi: siblingsAbi, functionName: "deposit" }), 1n, elsewhere),
    draft(encode({ abi: siblingsAbi, functionName: "requestWithdraw", args: [5n] }), 1n),
    draft(encode({ abi: siblingsAbi, functionName: "claimWithdrawByUUID", args: [1n] }), 1n),
    draft(encode({ abi: siblingsAbi, functionName: "deposit" })),
    draft(encode({ abi: siblingsAbi, functionName: "requestWithdraw", args: [0n] })),
    draft(concatHex([encode({ abi: siblingsAbi, functionName: "deposit" }), "0x00"]), 1n),
  ];
}
