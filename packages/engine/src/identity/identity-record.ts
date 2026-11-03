import {
  type AccountRef,
  accountRefSchema,
  type ChainRef,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { registrationFileSchema } from "@binference/chain/identity";
import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/**
 * An agent's identity in a chain's identity registry (database spec, `identities`; decision
 * 0335): the registry and the id it gave, the transaction that registered it, when that landed,
 * and the registration file as the transaction stored it. An agent holds at most one, written with
 * the move of its `registerIdentity` intent to `reconciled` once the registry read it back.
 */
export interface IdentityRecord {
  readonly agentId: Id<"agt">;
  readonly chain: ChainRef;
  readonly registry: AccountRef;
  /** The id the registry gave, in decimal. */
  readonly onchainId: string;
  readonly txHash: TxHash;
  readonly registeredAtMs: number;
  /** The registration file, a data URI. */
  readonly file: string;
}

/** Parses an identity as the store passes it. */
export const identityRecordSchema: z.ZodType<IdentityRecord> = z.strictObject({
  agentId: idSchema("agt"),
  chain: chainRefSchema,
  registry: accountRefSchema,
  onchainId: z.string().regex(/^(?:0|[1-9]\d{0,77})$/),
  txHash: z.string().refine(isTxHash),
  registeredAtMs: epochMsSchema,
  file: registrationFileSchema,
});
