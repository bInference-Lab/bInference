import { type AccountRef, accountRefSchema } from "@binference/chain";
import { type Id, idSchema, type JsonValue, jsonValueSchema, type Result } from "@binference/core";
import { z } from "zod";
import type { RescueState } from "../policy/rescue-change.js";
import { epochMsSchema, shortTextSchema } from "../records/record-fields.js";
import { type DisclaimerAcceptance, disclaimerAcceptanceSchema } from "./disclaimer-record.js";
import { pendingRescueSchema, type RescueCeiling, rescueCeilingSchema } from "./rescue-record.js";

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
  /**
   * The public half of the sealing key derived from the owner key, which backups are sealed to
   * (keys spec, section 7.2); absent until the owner key was entered once since the install kept
   * it, and backups are sealed to the owner key itself until then.
   */
  readonly sealKeyPublic?: string;
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
  sealKeyPublic: publicKeySchema.exactOptional(),
});

/** The public half of the sealing key, once the owner key derived it. */
export interface SealKeyRecord {
  /** DER SubjectPublicKeyInfo in base64. */
  readonly sealKeyPublic: string;
}

/** Parses a sealing key record. */
export const sealKeyRecordSchema: z.ZodType<SealKeyRecord> = z.strictObject({
  sealKeyPublic: publicKeySchema,
});

/**
 * This machine's agent key once it replaced the earlier one as the signer of every live wallet
 * (keys spec, section 6): the key quorum that holds it on Privy, its public half and when.
 */
export interface AgentKeyAttachment {
  readonly agentQuorumId: string;
  /** DER SubjectPublicKeyInfo in base64. */
  readonly agentKeyPublic: string;
  readonly atMs: number;
}

/** The keys an install keeps in its custody: this machine's agent key, and the sealing key's. */
export interface CustodyKeyStore {
  /**
   * Records this machine's agent key as the signer of every live wallet once custody moved them
   * (keys spec, section 6), in one transaction: the custody's agent key quorum, its public half
   * and when it attached, and each live wallet's signer. Archived wallets keep the signer they
   * had. An install that was never set up is `not_set_up` and changes nothing.
   */
  attach(
    attachment: AgentKeyAttachment,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<void, "not_set_up">>;
  /**
   * Keeps the public half of the sealing key the owner key derived (keys spec, section 7.2), which
   * the next backups are sealed to. An install that was never set up is `not_set_up` and changes
   * nothing.
   */
  setSealKey(
    key: SealKeyRecord,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<void, "not_set_up">>;
}

/** Parses an agent key attachment. */
export const agentKeyAttachmentSchema: z.ZodType<AgentKeyAttachment> = z.strictObject({
  agentQuorumId: shortTextSchema,
  agentKeyPublic: publicKeySchema,
  atMs: epochMsSchema,
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

/** A wallet's ceiling as custody read it back after a change, for the wallet's stored copy. */
export interface CeilingUpdate {
  readonly wallet: Id<"wal">;
  readonly ceiling: CeilingMirror;
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
  /**
   * `launch` for the agent's launch wallet, whose ceiling also allows the calls launchpads declare
   * on the contracts each launch makes (decision 0217); absent for an agent wallet. Only a rebuild
   * leaves an agent more than one live launch wallet (decision 0218).
   */
  readonly role?: WalletRole;
}

/** What a wallet is for beyond an agent wallet's trades: `launch`, a launch wallet. */
export type WalletRole = "launch";

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
  role: z.literal("launch").exactOptional(),
};

/** Parses a ceiling update. */
export const ceilingUpdateSchema: z.ZodType<CeilingUpdate> = z.strictObject({
  wallet: idSchema("wal"),
  ceiling: ceilingMirrorSchema,
});

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

/**
 * The install as it stands: its custody, its rescue address with a new one that waits, its
 * freeze, the disclaimer its owner accepted, and its wallets, oldest first. Read the rescue address in effect through `rescueAt`.
 */
export interface InstallFacts extends RescueState {
  readonly custody?: CustodyRecord;
  /** When the whole install was frozen; every agent created since starts frozen. */
  readonly frozenAtMs?: number;
  /** The ceiling changes kept for the new rescue address that waits. */
  readonly rescueCeiling?: RescueCeiling;
  /** The disclaimer the owner accepted last; none before the owner accepted one. */
  readonly disclaimer?: DisclaimerAcceptance;
  readonly wallets: readonly WalletRecord[];
}

/** Parses install facts. */
export const installFactsSchema: z.ZodType<InstallFacts> = z.strictObject({
  custody: custodyRecordSchema.exactOptional(),
  frozenAtMs: epochMsSchema.exactOptional(),
  rescueAddress: accountRefSchema.exactOptional(),
  pendingRescue: pendingRescueSchema.exactOptional(),
  rescueCeiling: rescueCeilingSchema.exactOptional(),
  disclaimer: disclaimerAcceptanceSchema.exactOptional(),
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
