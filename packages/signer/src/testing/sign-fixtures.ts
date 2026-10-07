import {
  type AccountRef,
  accountRefSchema,
  type ChainRef,
  chainRefSchema,
  type AuthorizeInput,
} from "@binference/chain";
import { idSchema, type JsonValue } from "@binference/core";
import type { SignerSettings } from "../process/signer-settings.schema.js";

/** The chain the fixtures run on. */
const fixtureChain: ChainRef = chainRefSchema.parse("eip155:56");

/** The time the fixtures are signed at, epoch milliseconds. */
export const fixtureNowMs: number = 1_800_000_000_000;

/** The fixtures' signer settings: the fixture chain and Privy's API. */
export const fixtureSettings: SignerSettings = {
  chains: [fixtureChain],
  privyApi: "https://api.privy.io",
};

/** An EVM address on the fixture chain, as a CAIP-10 account. */
export function accountOn(address: string): AccountRef {
  return accountRefSchema.parse(`${fixtureChain}:${address}`);
}

/** The fixtures' addresses: the wallet, a router, a token, a saved address and a stranger. */
export const fixtureAddresses: Readonly<
  Record<"wallet" | "router" | "token" | "saved" | "stranger", string>
> = {
  wallet: "0x8894e0a0c962cb723c1976a4421c95949be2d4e3",
  router: "0x13f4ea83d0bd40e75c8222255bc855a974568dd4",
  token: "0x55d398326f99059ff775485246999027b3197955",
  saved: "0x2222222222222222222222222222222222222222",
  stranger: "0x3333333333333333333333333333333333333333",
};

const custodyId = "fmfdj6yqly31huorjqzq38zc";
const intent = idSchema("int").parse("int_0192f3a4-5b6c-7d8e-9f00-112233445566");
/** The terms hash the fixture authorizations carry. */
export const fixtureTermsHash: string = "ab".repeat(32);

/** The Privy RPC URL of the fixture wallet. */
const fixtureRpcUrl: string = `https://api.privy.io/v1/wallets/${custodyId}/rpc`;

/** The fields of an EVM transaction as Privy's `eth_signTransaction` body carries them. */
export type FixtureTransaction = Readonly<Record<string, JsonValue>>;

/** A 0.01 BNB call to the router, at nonce 7, under the network fee cap of 1 gwei. */
const fixtureTransaction: FixtureTransaction = {
  to: fixtureAddresses.router,
  value: "0x2386f26fc10000",
  chain_id: 56,
  nonce: 7,
  gas_limit: 300_000,
  max_fee_per_gas: "0x3b9aca00",
  max_priority_fee_per_gas: "0x0",
  type: 2,
  data: "0x7ff36ab5",
};

/**
 * A request every hard rule passes: the router call of {@link fixtureTransaction}, confirmed by
 * the owner until one minute after {@link fixtureNowMs}.
 */
export function authorizeFixture(
  transaction: FixtureTransaction = fixtureTransaction,
): AuthorizeInput {
  return {
    wallet: {
      id: idSchema("wal").parse("wal_0192f3a4-5b6c-7d8e-9f00-112233445566"),
      custodyId,
      account: accountOn(fixtureAddresses.wallet),
    },
    request: {
      method: "POST",
      url: fixtureRpcUrl,
      headers: { "privy-app-id": "cm4xb2l3c00000000000000000" },
      body: { method: "eth_signTransaction", params: { transaction } },
    },
    intent,
    step: { index: 0, chain: fixtureChain, action: { kind: "call", nativeValue: 10n ** 16n } },
    authorization: {
      kind: "confirmation",
      id: idSchema("cnf").parse("cnf_0192f3a4-5b6c-7d8e-9f00-112233445566"),
      intent,
      termsHash: fixtureTermsHash,
      expiresAtMs: fixtureNowMs + 60_000,
    },
    termsHash: fixtureTermsHash,
    allowed: {
      contracts: [accountOn(fixtureAddresses.router)],
      spenders: [accountOn(fixtureAddresses.router)],
      recipients: [accountOn(fixtureAddresses.saved)],
    },
  };
}

const word = (hex: string): string => hex.padStart(64, "0");

/** The calldata of an ERC-20 `approve(spender, amount)`. */
export function approveCalldata(spender: string, amount: bigint): string {
  return `0x095ea7b3${word(spender.slice(2))}${word(amount.toString(16))}`;
}

/** The calldata of an ERC-20 `transfer(recipient, amount)`. */
export function transferCalldata(recipient: string, amount: bigint): string {
  return `0xa9059cbb${word(recipient.slice(2))}${word(amount.toString(16))}`;
}

/** The fixture request with these transaction fields over {@link fixtureTransaction}'s. */
export function withTransaction(
  input: AuthorizeInput,
  fields: FixtureTransaction,
  without: readonly string[] = [],
): AuthorizeInput {
  const transaction = Object.fromEntries(
    Object.entries({ ...fixtureTransaction, ...fields }).filter(([key]) => !without.includes(key)),
  );
  return {
    ...input,
    request: { ...input.request, body: { method: "eth_signTransaction", params: { transaction } } },
  };
}
