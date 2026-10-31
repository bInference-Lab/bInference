import type { Venue } from "../venues/venue.js";
import { createFakeVenue } from "./fake-venue.js";

/**
 * The JSON ABI entry of the fake bridge's deposit: it names its depositor and an order id, and no
 * recipient, as a Relay deposit does (decision 0303).
 */
export const fakeDepositAbi = {
  type: "function",
  name: "depositErc20",
  inputs: [
    { type: "address", name: "depositor" },
    { type: "address", name: "token" },
    { type: "uint256", name: "amount" },
    { type: "bytes32", name: "id" },
  ],
  outputs: [],
  stateMutability: "nonpayable",
} as const;

/**
 * Creates the `fake-bridge` venue of the fake chain, for tests: every call and spender it declares
 * is a bridge wallet's alone (decision 0303), its deposit on its `router` with the depositor pinned
 * to the wallet, and the router as a spender only a bridge wallet approves. It quotes and builds as
 * the fake swap venue does. The registry must list a router for `fake-bridge`.
 */
export function createFakeBridgeVenue(): Venue {
  const base = createFakeVenue();
  return {
    ...base,
    id: "fake-bridge",
    contracts: base.contracts.map((item) => ({
      chain: item.chain,
      names: item.names,
      calls: [
        {
          contract: "router",
          abi: fakeDepositAbi,
          walletInputs: ["depositor"],
          onlyWallet: "bridge",
        },
      ],
      onlyWalletSpenders: { bridge: ["router"] },
    })),
  };
}
