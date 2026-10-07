import { type AccountRef, accountRefSchema } from "@binference/chain";
import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema, shortTextSchema } from "../records/record-fields.js";

/**
 * The install's custody on Privy (database spec, section 2.1): the owner's app, and the key
 * quorums of the owner key and of this machine's agent key, each with its public half as DER
 * SubjectPublicKeyInfo in base64. It holds no secret.
 */
export interface CustodyRecord {
  readonly provider: "privy";
  readonly appId: string;
  readonly ownerQuorumId: string;
  readonly ownerKeyPublic: string;
  readonly agentQuorumId: string;
  readonly agentKeyPublic: string;
  /** When this machine's agent key became the wallets' signer. */
  readonly attachedAtMs: number;
}

const publicKeySchema = z.base64().min(1).max(512);

/** Parses a custody record. */
export const custodyRecordSchema: z.ZodType<CustodyRecord> = z.strictObject({
  provider: z.literal("privy"),
  appId: shortTextSchema,
  ownerQuorumId: shortTextSchema,
  ownerKeyPublic: publicKeySchema,
  agentQuorumId: shortTextSchema,
  agentKeyPublic: publicKeySchema,
  attachedAtMs: epochMsSchema,
});

/** A wallet's ceiling as read back from Privy: its policy mirrored, and its native cap. */
export interface CeilingMirror {
  readonly policyId: string;
  /** The policy's rules as Privy reported them at the read-back. */
  readonly policy: JsonValue;
  /** The most native coin one contract call may send, in base units. */
  readonly perTxNativeBase: bigint;
  readonly readAtMs: number;
}

/** An agent wallet held in Privy, owned by the owner key with the agent key as its signer. */
export interface WalletDraft {
  readonly id: Id<"wal">;
  readonly agentId: Id<"agt">;
  /** The chain family the wallet signs for, as the registry names it. */
  readonly family: string;
  readonly custody: "privy";
  /** Privy's id of the wallet. */
  readonly custodyWalletId: string;
  /** Privy's id of the wallet's policy: its ceiling. */
  readonly policyId: string;
  /** Privy's id of the key quorum that signs for the wallet. */
  readonly signerId: string;
  /** The wallet's address, in its family's canonical form. */
  readonly address: string;
  readonly label: string;
  readonly createdAtMs: number;
  readonly ceiling: CeilingMirror;
}

/** A wallet as the store keeps it; an archived wallet is one the install no longer uses. */
export interface WalletRecord extends WalletDraft {
  readonly archivedAtMs?: number;
}

const ceilingMirrorSchema = z.strictObject({
  policyId: shortTextSchema,
  policy: jsonValueSchema,
  perTxNativeBase: z.bigint().nonnegative(),
  readAtMs: epochMsSchema,
});

const walletShape = {
  id: idSchema("wal"),
  agentId: idSchema("agt"),
  family: shortTextSchema,
  custody: z.literal("privy"),
  custodyWalletId: shortTextSchema,
  policyId: shortTextSchema,
  signerId: shortTextSchema,
  address: shortTextSchema,
  label: shortTextSchema,
  createdAtMs: epochMsSchema,
  ceiling: ceilingMirrorSchema,
};

/** Parses a wallet draft. */
export const walletDraftSchema: z.ZodType<WalletDraft> = z.strictObject(walletShape);

/** Parses a wallet record. */
export const walletRecordSchema: z.ZodType<WalletRecord> = z.strictObject({
  ...walletShape,
  archivedAtMs: epochMsSchema.exactOptional(),
});

/**
 * What `binference init` sets up in one write (keys spec, section 2): the custody, the rescue
 * address and the first wallet, whose agent exists already. Starting over replaces the custody
 * and the rescue address of an install that was set up; either way, every wallet the install
 * used before is archived.
 */
export interface InstallSetup {
  readonly atMs: number;
  readonly custody: CustodyRecord;
  readonly rescueAddress: AccountRef;
  readonly wallet: WalletDraft;
  readonly isStartOver: boolean;
}

/** Parses an install setup. */
export const installSetupSchema: z.ZodType<InstallSetup> = z.strictObject({
  atMs: epochMsSchema,
  custody: custodyRecordSchema,
  rescueAddress: accountRefSchema,
  wallet: walletDraftSchema,
  isStartOver: z.boolean(),
});

/** The install as it stands: its custody, its rescue address and its wallets, oldest first. */
export interface InstallFacts {
  readonly custody?: CustodyRecord;
  readonly rescueAddress?: AccountRef;
  readonly wallets: readonly WalletRecord[];
}

/** Parses install facts. */
export const installFactsSchema: z.ZodType<InstallFacts> = z.strictObject({
  custody: custodyRecordSchema.exactOptional(),
  rescueAddress: accountRefSchema.exactOptional(),
  wallets: z.array(walletRecordSchema),
});

/** The install's id, proposed with the time the install began, for when it has none yet. */
export interface InstallIdProposal {
  readonly id: Id<"ins">;
  readonly atMs: number;
}

/** Parses an install id proposal. */
export const installIdProposalSchema: z.ZodType<InstallIdProposal> = z.strictObject({
  id: idSchema("ins"),
  atMs: epochMsSchema,
});
