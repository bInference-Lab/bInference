import { jsonValueSchema } from "@binference/core";
import { APIError } from "@privy-io/node";
import { z } from "zod";
import { isPrivyId, type KeyQuorum, type PrivyPolicy, type WalletRecord } from "./privy-records.js";

// Privy may add fields to its answers at any time, so objects keep the fields read and drop the
// rest. A field that is read is checked strictly.
const privyId = z.string().refine(isPrivyId);
const listOfIds = z.array(privyId);

const keyQuorumWire = z.object({
  id: privyId,
  authorization_threshold: z.number().int().positive().nullish(),
  authorization_keys: z.array(z.object({ public_key: z.string().min(1).max(512) })),
  user_ids: z.array(z.string()).nullish(),
  key_quorum_ids: z.array(z.string()).nullish(),
});

const policyWire = z.object({
  id: privyId,
  version: z.string(),
  chain_type: z.string(),
  owner_id: privyId.nullable(),
  rules: z.array(jsonValueSchema),
});

const walletWire = z.object({
  id: privyId,
  address: z.string(),
  chain_type: z.string(),
  owner_id: privyId.nullable(),
  policy_ids: listOfIds,
  additional_signers: z.array(
    z.object({ signer_id: privyId, override_policy_ids: listOfIds.nullish() }),
  ),
});

const signedWire = z.object({
  signed_transaction: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
  encoding: z.literal("rlp"),
});

const failureWire = z.looseObject({
  code: z.string().optional(),
  error: z.string().optional(),
});

// Privy's own examples break a public key's base64 into lines, as PEM does.
function keyText(text: string): string {
  return text.replaceAll(/\s/g, "");
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Reads a key quorum from the SDK's answer; an answer of another shape is undefined. */
export function readKeyQuorum(answer: unknown): KeyQuorum | undefined {
  const wire = parsed(keyQuorumWire, answer);
  return wire === undefined
    ? undefined
    : {
        id: wire.id,
        publicKeys: wire.authorization_keys.map((key) => keyText(key.public_key)),
        threshold: wire.authorization_threshold ?? null,
        userIds: wire.user_ids ?? [],
        memberQuorums: wire.key_quorum_ids ?? [],
      };
}

/** Reads a policy from the SDK's answer; an answer of another shape is undefined. */
export function readPolicy(answer: unknown): PrivyPolicy | undefined {
  const wire = parsed(policyWire, answer);
  return wire === undefined
    ? undefined
    : {
        id: wire.id,
        version: wire.version,
        chainType: wire.chain_type,
        ownerId: wire.owner_id,
        rules: wire.rules,
      };
}

/** Reads a wallet from the SDK's answer; an answer of another shape is undefined. */
export function readWallet(answer: unknown): WalletRecord | undefined {
  const wire = parsed(walletWire, answer);
  return wire === undefined
    ? undefined
    : {
        id: wire.id,
        address: wire.address,
        chainType: wire.chain_type,
        ownerId: wire.owner_id,
        policyIds: wire.policy_ids,
        signers: wire.additional_signers.map((signer) => ({
          signerId: signer.signer_id,
          overridePolicyIds: signer.override_policy_ids ?? null,
        })),
      };
}

/** Reads the signed transaction from the SDK's answer to `eth_signTransaction`. */
export function readSignedTransaction(answer: unknown): string | undefined {
  return parsed(signedWire, answer)?.signed_transaction;
}

/**
 * Every API error code Privy documents ("API error codes", docs.privy.io/basics/troubleshooting/
 * error-handling/api-errors), with the start of its documented description. An answer may carry
 * the code, or only the description: a signature Privy did not accept came back as text alone.
 * The descriptions are lowercase; an answer's text is compared lowercased.
 */
const documentedErrors = [
  ["policy_violation", ["rpc request denied due to policy violation"]],
  ["insufficient_funds", ["insufficient funds", "insufficient gas credits"]],
  ["transaction_broadcast_failure", ["transaction failed to broadcast"]],
  ["missing_or_empty_authorization_header", ["missing `privy-authorization-signature` header"]],
  ["zero_correct_authorization_signatures", ["no valid authorization signatures were provided"]],
  ["insufficient_correct_authorization_signatures", ["not enough valid authorization signatures"]],
  ["incorrect_quantity_of_authorization_signatures", ["number of signatures does not match"]],
  ["request_expired", ["the request has expired"]],
  ["no_valid_user_session_keys", ["no valid user signing keys"]],
  ["user_session_keys_expired", ["user signing key is expired"]],
] as const;

/** One of the API error codes Privy documents. */
export type PrivyErrorCode = (typeof documentedErrors)[number][0];

function isPrivyErrorCode(code: string): code is PrivyErrorCode {
  return documentedErrors.some(([known]) => known === code);
}

/**
 * The documented code an error answer names: its `code` field, an `error` text that is a code in
 * any case, or an `error` text that holds a code's documented description.
 */
export function readPrivyErrorCode(body: unknown): PrivyErrorCode | undefined {
  const wire = failureWire.safeParse(body);
  if (!wire.success) {
    return undefined;
  }
  const { code, error } = wire.data;
  if (code !== undefined && isPrivyErrorCode(code)) {
    return code;
  }
  const text = (error ?? "").trim().toLowerCase();
  if (isPrivyErrorCode(text)) {
    return text;
  }
  if (text === "") {
    return undefined;
  }
  return documentedErrors.find(([, descriptions]) =>
    descriptions.some((words) => text.includes(words)),
  )?.[0];
}

/**
 * Why Privy refused a signing request: a policy violation; an authorization signature it did not
 * accept, from a key that is not, or no longer, the wallet's signer; or a request whose expiry had
 * passed.
 */
export type PrivyRefusal = "policy" | "authorization" | "expired";

const refusals: Partial<Record<PrivyErrorCode, PrivyRefusal>> = {
  policy_violation: "policy",
  missing_or_empty_authorization_header: "authorization",
  zero_correct_authorization_signatures: "authorization",
  insufficient_correct_authorization_signatures: "authorization",
  incorrect_quantity_of_authorization_signatures: "authorization",
  request_expired: "expired",
};

/** The refusal a documented error code means, or undefined for any other failure. */
export function refusalOf(code: PrivyErrorCode | undefined): PrivyRefusal | undefined {
  return code === undefined ? undefined : refusals[code];
}

const statusWire = z.object({ status: z.int().min(100).max(599), message: z.string() });

/**
 * Reads the status of an answer the SDK threw as an `APIError`, with the documented error code it
 * names; an error that got no answer, or any other error, is undefined. Privy's free text never
 * leaves this function: it may echo what the request held.
 */
export function readStatus(
  error: Error,
): { readonly status: number; readonly code?: PrivyErrorCode } | undefined {
  const wire = error instanceof APIError ? statusWire.safeParse(error) : undefined;
  if (!(error instanceof APIError) || wire?.success !== true) {
    return undefined;
  }
  const code = readPrivyErrorCode(error.error);
  return code === undefined ? { status: wire.data.status } : { status: wire.data.status, code };
}
