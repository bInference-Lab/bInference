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

function parsedText<T>(schema: z.ZodType<T>, text: string): T | undefined {
  try {
    return parsed(schema, JSON.parse(text));
  } catch {
    return undefined;
  }
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
 * Why Privy refused a request, by the error code its answer names: a policy violation; an
 * authorization signature it did not accept, from a key that is not, or no longer, the wallet's
 * signer; or a request whose expiry had passed.
 */
export type PrivyRefusal = "policy" | "authorization" | "expired";

const authorizationCodes = [
  "missing_or_empty_authorization_header",
  "zero_correct_authorization_signatures",
  "insufficient_correct_authorization_signatures",
  "incorrect_quantity_of_authorization_signatures",
];

/**
 * Reads the refusal an error answer names. Privy documents its codes but not where its answer
 * carries them, so the `code` and `error` fields and the whole text are searched.
 */
export function readRefusal(body: string): PrivyRefusal | undefined {
  const wire = parsedText(failureWire, body);
  const text = [wire?.code ?? "", wire?.error ?? "", body].join(" ").toLowerCase();
  if (text.includes("policy_violation") || text.includes("policy violation")) {
    return "policy";
  }
  if (authorizationCodes.some((code) => text.includes(code))) {
    return "authorization";
  }
  return text.includes("request_expired") ? "expired" : undefined;
}

const statusWire = z.object({ status: z.int().min(100).max(599), message: z.string() });

/**
 * Reads the status and the text of an answer the SDK threw as an `APIError`; an error that got
 * no answer, or any other error, is undefined. The text holds the answer's body as JSON.
 */
export function readStatus(
  error: Error,
): { readonly status: number; readonly text: string } | undefined {
  const wire = error instanceof APIError ? statusWire.safeParse(error) : undefined;
  if (!(error instanceof APIError) || wire?.success !== true) {
    return undefined;
  }
  const body: unknown = error.error;
  return { status: wire.data.status, text: `${JSON.stringify(body) ?? ""} ${wire.data.message}` };
}
