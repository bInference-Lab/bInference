import type { AccountCode, AccountCodeReader, AccountRef } from "@binference/chain";
import { type Address, encodeFunctionData, erc20Abi, type Hex } from "viem";
import type { EvmChain } from "../evm-chain.js";
import { hexSchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { accountAddressOn } from "../sending/account-address-on.js";

/** What the EVM account code reader reads one chain through. */
export interface EvmAccountCodeReaderOptions {
  readonly rpc: RpcFailover;
  readonly chain: EvmChain;
}

// EIP-7702's designator: 0xef0100 then the 20-byte address the account delegates to.
const delegationPattern = /^0xef0100[0-9a-f]{40}$/i;
const supplyCall = encodeFunctionData({ abi: erc20Abi, functionName: "totalSupply" });
const decimalsCall = encodeFunctionData({ abi: erc20Abi, functionName: "decimals" });
// One 32-byte word, and for decimals one that a `uint8` holds.
const wordPattern = /^0x[0-9a-f]{64}$/i;
const maxDecimals = 255n;

// What the contract answers to a call; `undefined` when the node answers an error, as a revert.
async function answerOf(
  options: EvmAccountCodeReaderOptions,
  call: { readonly to: Address; readonly data: Hex; readonly signal: AbortSignal },
): Promise<Hex | undefined> {
  const reply = await options.rpc.request({
    method: "eth_call",
    params: [{ to: call.to, data: call.data }, "latest"],
    result: hexSchema,
    signal: call.signal,
  });
  return reply.kind === "result" ? reply.value : undefined;
}

// A token answers its supply and its decimals as ERC-20 writes them; any other code is none.
async function isToken(
  options: EvmAccountCodeReaderOptions,
  to: Address,
  signal: AbortSignal,
): Promise<boolean> {
  const [supply, decimals] = await Promise.all([
    answerOf(options, { to, data: supplyCall, signal }),
    answerOf(options, { to, data: decimalsCall, signal }),
  ]);
  return (
    supply !== undefined &&
    wordPattern.test(supply) &&
    decimals !== undefined &&
    wordPattern.test(decimals) &&
    BigInt(decimals) <= maxDecimals
  );
}

/**
 * Creates the EVM family's {@link AccountCodeReader} for one chain (decision 0318): the account's
 * code at the latest block (`eth_getCode`) is `none` when empty and `delegation` when it is only
 * an EIP-7702 designator; other code is a `token` when it answers ERC-20's `totalSupply()` and
 * `decimals()` with one word each, the decimals at most 255, else a `contract`. A call the node
 * answers with an error, as a revert, counts as no answer. An account of another chain is a
 * `chain.unknown_chain` fault; a read no endpoint answers rejects, and so does the signal.
 */
export function createEvmAccountCodeReader(
  options: EvmAccountCodeReaderOptions,
): AccountCodeReader {
  return {
    chain: options.chain.ref,
    async read(account: AccountRef, { signal }): Promise<AccountCode> {
      signal.throwIfAborted();
      const address = accountAddressOn(options.chain, account);
      const code = await requestResult(options.rpc, {
        method: "eth_getCode",
        params: [address, "latest"],
        result: hexSchema,
        signal,
      });
      if (code === "0x") {
        return "none";
      }
      if (delegationPattern.test(code)) {
        return "delegation";
      }
      return (await isToken(options, address, signal)) ? "token" : "contract";
    },
  };
}
