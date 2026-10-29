import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { type Address, encodeFunctionData, getAddress, numberToHex, parseAbi } from "viem";
import { crashBalanceSlot, crashTokenCodeOf } from "../crash/crash-token.js";

/**
 * What a refusing token keeps its buyers from: selling, as a honeypot whose every move into its
 * pool reverts, or passing on what they bought, as a token only its pool may move.
 */
export type TokenRefusalKind = "sale" | "transfer";

const factoryAbi = parseAbi([
  "function createPair(address tokenA, address tokenB) returns (address pair)",
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
]);
const wbnbAbi = parseAbi([
  "function deposit() payable",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const pairAbi = parseAbi(["function mint(address to) returns (uint256 liquidity)"]);

const factory = bscContract("pancakeswap", "v2-factory");
const wbnb = bscToken("WBNB");
// Addresses no BSC contract holds, so the fork's own state never shapes the token.
const tokenOf: Readonly<Record<TokenRefusalKind, Address>> = {
  sale: getAddress(`0x${"5a1e".repeat(10)}`),
  transfer: getAddress(`0x${"7f0e".repeat(10)}`),
};
// The pool's two sides: 10 BNB against a million units of 18 decimals, deep enough that a 0.02 BNB
// test buy moves the price little.
const poolBnb = 10n * 10n ** 18n;
const poolUnits = 10n ** 24n;

/**
 * Places a token on the fork whose moves follow its refusal, with its own PancakeSwap v2 pair
 * against WBNB holding both sides, so a router buys it as any new token and the round trip finds
 * what it refuses. Its code is the crash chain's ERC-20; the pair's units are written into its
 * balance slot, as no transfer into the pair runs for a token that refuses one.
 */
export async function placeRefusingToken(fork: Fork, kind: TokenRefusalKind): Promise<Address> {
  const token = tokenOf[kind];
  const from = fork.account;
  await fork.send({
    from,
    to: factory,
    data: encodeFunctionData({ abi: factoryAbi, functionName: "createPair", args: [token, wbnb] }),
  });
  const pair = await fork.client.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "getPair",
    args: [token, wbnb],
  });
  const refusal = kind === "sale" ? "into" : "onlyFrom";
  await fork.call("anvil_setCode", [
    token,
    crashTokenCodeOf(undefined, { kind: refusal, address: pair }),
  ]);
  await fork.call("anvil_setStorageAt", [
    token,
    crashBalanceSlot(pair),
    numberToHex(poolUnits, { size: 32 }),
  ]);
  // The pool's BNB on top of what the account holds, so the fork's other tests keep theirs.
  const held = await fork.client.getBalance({ address: from });
  await fork.call("anvil_setBalance", [from, numberToHex(held + poolBnb)]);
  const deposit = encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" });
  await fork.send({ from, to: wbnb, value: poolBnb, data: deposit });
  const pay = encodeFunctionData({ abi: wbnbAbi, functionName: "transfer", args: [pair, poolBnb] });
  await fork.send({ from, to: wbnb, data: pay });
  const mint = encodeFunctionData({ abi: pairAbi, functionName: "mint", args: [from] });
  await fork.send({ from, to: pair, data: mint });
  return token;
}
