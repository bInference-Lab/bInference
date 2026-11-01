import { type ChainRef, chainRefSchema } from "@binference/plugin-sdk";

/** How Relay names one chain: its numeric id, its protocol id in orders, and its machine. */
export interface RelayChain {
  readonly chain: ChainRef;
  /** The id Relay's API takes, in decimal: the EIP-155 id, or Relay's own for Solana. */
  readonly id: string;
  /** The chain's name in a Relay order (`orderData`), such as `bnb` or `solana`. */
  readonly protocol: string;
  /** How an order writes the chain's addresses: EVM hex or Solana base58. */
  readonly vm: "evm" | "svm";
}

const chain = (text: string) => chainRefSchema.parse(text);

// The chains Relay names for the routes the registry lists, as `GET /chains` answered on
// 2026-11-01: each chain's `id`, `protocol.v2.chainId` and `vmType`.
const listed: readonly RelayChain[] = [
  { chain: chain("eip155:56"), id: "56", protocol: "bnb", vm: "evm" },
  { chain: chain("eip155:1"), id: "1", protocol: "ethereum", vm: "evm" },
  { chain: chain("eip155:8453"), id: "8453", protocol: "base", vm: "evm" },
  { chain: chain("eip155:42161"), id: "42161", protocol: "arbitrum", vm: "evm" },
  { chain: chain("eip155:4663"), id: "4663", protocol: "robinhood", vm: "evm" },
  {
    chain: chain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
    id: "792703809",
    protocol: "solana",
    vm: "svm",
  },
];

/** How Relay names the chain, or `undefined` for a chain no listed route touches. */
export function relayChainOf(chainRef: ChainRef): RelayChain | undefined {
  return listed.find((item) => item.chain === chainRef);
}

/** The chain an order's protocol id names, or `undefined` for one no listed route touches. */
export function relayChainNamed(protocol: string): RelayChain | undefined {
  return listed.find((item) => item.protocol === protocol);
}

/**
 * Relay's solver on every EVM chain, as Relay's contract addresses page lists it: an order names
 * it, and it pays each fill and each refund of the routes the registry lists from its own
 * balance, so a settlement's token transfer comes from it.
 */
export const relaySolver = "0xf70da97812cb96acdf810712aa562db8dfa3dbef";

/**
 * The extra data Relay wrote on an EVM leg of every order it quoted on 2026-11-01, a 32-byte word
 * naming one of its contracts; a Solana leg wrote none. Relay's docs do not describe it.
 */
export const relayLegData = "0x0000000000000000000000000729e2a4716d9f7dd17858d5d504426d228697f7";

/**
 * The SPL Memo program, through which Relay's fill on Solana writes the order id it pays, as
 * Solana's program library names it.
 */
export const memoProgram = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
