import type { Clock, Random } from "@binference/core";
import type { FakeRule } from "./fake-privy-request.schema.js";

/** A key quorum the fake holds: P-256 public keys in base64 DER and a threshold. */
export interface FakeQuorum {
  readonly id: string;
  readonly publicKeys: readonly string[];
  readonly threshold: number;
  readonly displayName: string | null;
}

/** A policy the fake holds; each rule has the id the fake gave it. */
export interface FakePolicy {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string | null;
  readonly rules: readonly (FakeRule & { readonly id: string })[];
  readonly createdAt: number;
}

/** An added signer of a fake wallet. */
export interface FakeSigner {
  readonly signerId: string;
  readonly overridePolicyIds: readonly string[] | undefined;
}

/** A wallet the fake holds, with the secp256k1 key that never leaves it. */
export interface FakeWallet {
  readonly id: string;
  readonly address: string;
  readonly privateKey: `0x${string}`;
  readonly ownerId: string | null;
  readonly policyIds: readonly string[];
  readonly signers: readonly FakeSigner[];
  readonly createdAt: number;
}

/** Everything the fake keeps, and where its ids, keys and time come from. */
export interface FakePrivyState {
  readonly appId: string;
  readonly origin: string;
  readonly clock: Clock;
  readonly random: Random;
  readonly quorums: Map<string, FakeQuorum>;
  readonly policies: Map<string, FakePolicy>;
  readonly wallets: Map<string, FakeWallet>;
}

const idAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

/** The most quorums, policies or wallets the fake holds; it refuses to make one more. */
export const maxHeld = 1_000;

/** A new id shaped like Privy's: 24 lowercase letters and digits. */
export function newFakeId(state: FakePrivyState): string {
  return [...state.random.bytes(24)]
    .map((byte) => idAlphabet.charAt(byte % idAlphabet.length))
    .join("");
}

/** A new secp256k1 private key in hex. */
export function newPrivateKey(state: FakePrivyState): `0x${string}` {
  return `0x${Buffer.from(state.random.bytes(32)).toString("hex")}`;
}
