import {
  accountRefParts,
  type AccountRef,
  accountRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  err,
  jsonValueSchema,
  ok,
  type Result,
  type Secret,
} from "@binference/core";
import {
  isPrivyId,
  type OwnerAuthorize,
  readCeiling,
  type PrivyApi,
  type PrivyId,
  type RecipientsRefusal,
  sendSignedRecipients,
  setCeilingRecipients,
  signCeilingRecipients,
  signedRecipientsSchema,
  type SignedRecipients,
} from "@binference/custody-privy";
import type {
  CeilingEditor,
  CeilingRead,
  CeilingRefusal,
  RecipientsRequest,
  SignedCeilingChange,
  SignedChangeRefusal,
  SignRecipientsRequest,
} from "@binference/engine/install";
import { parseOwnerKeyCode, signAuthorization } from "@binference/signer";
import { z } from "zod";

/** What the Privy ceiling editor reaches Privy with, and the owner key it takes. */
export interface PrivyCeilingEditorOptions {
  readonly api: PrivyApi;
  readonly clock: Clock;
  /** The owner key's public half the install's custody holds; undefined before `init`. */
  readonly ownerKeyPublic: (signal: AbortSignal) => Promise<string | undefined>;
}

// A change signed now goes out at once; five minutes covers every ceiling of an install.
const nowExpiryMs = 5 * 60_000;

const payloadSchema = z.array(signedRecipientsSchema);

// Privy compares addresses as text: each account's address once, in the order given.
function addressesOf(accounts: readonly AccountRef[]): readonly string[] {
  return [...new Set(accounts.map((account) => accountRefParts(account).address))];
}

type Authorized = Result<OwnerAuthorize, CeilingRefusal>;

// The owner key from its code, when it is the key that owns the install's ceilings.
async function ownerOf(
  options: PrivyCeilingEditorOptions,
  code: Secret,
  signal: AbortSignal,
): Promise<Authorized> {
  signal.throwIfAborted();
  const pair = parseOwnerKeyCode(code);
  const expected = await options.ownerKeyPublic(signal);
  if (!pair.ok || expected === undefined || pair.value.publicKey !== expected) {
    return err("bad_owner_key");
  }
  const { privateKey } = pair.value;
  return ok(async (request) => ok(signAuthorization(privateKey, request)));
}

function policyOf(ceiling: string): Result<PrivyId, CeilingRefusal> {
  return isPrivyId(ceiling) ? ok(ceiling) : err("not_found");
}

function refusalOf(error: RecipientsRefusal): CeilingRefusal {
  if (error === "malformed_address" || error === "too_many_addresses") {
    return "bad_recipients";
  }
  return error === "refused" ? "bad_owner_key" : "not_found";
}

type Options = PrivyCeilingEditorOptions;

// Each address on each chain the ceiling enables, as custody's accounts.
function accountsOn(
  chains: readonly ChainRef[],
  addresses: readonly string[],
): readonly AccountRef[] {
  return chains.flatMap((chain) =>
    addresses.map((address) => accountRefSchema.parse(`${chain}:${address}`)),
  );
}

async function read(
  options: Options,
  ceiling: string,
  signal: AbortSignal,
): Promise<Result<CeilingRead, "not_found">> {
  const policy = policyOf(ceiling);
  const held = policy.ok ? await options.api.policy(policy.value, { signal }) : undefined;
  if (held?.ok !== true) {
    return err("not_found");
  }
  const rules = readCeiling(held.value.rules);
  if (rules === undefined) {
    throw new BinferenceError({
      code: "custody.privy_malformed",
      message: "Privy holds a ceiling whose rules binference cannot read.",
      details: { path: "/v1/policies" },
    });
  }
  const chains = rules.chainIds.map((id) => chainRefSchema.parse(`eip155:${id}`));
  return ok({
    chains,
    contracts: accountsOn(chains, rules.contracts),
    perTxNativeBase: rules.perTxNativeCapBase,
    recipients: accountsOn(chains, rules.recipients),
  });
}

async function setRecipients(
  options: Options,
  { ownerKey, ceilings }: RecipientsRequest,
  signal: AbortSignal,
): Promise<Result<void, CeilingRefusal>> {
  const authorize = await ownerOf(options, ownerKey, signal);
  if (!authorize.ok) {
    return authorize;
  }
  for (const { ceiling, recipients } of ceilings) {
    const policy = policyOf(ceiling);
    if (!policy.ok) {
      return policy;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one ceiling at a time: a refusal stops the rest
    const set = await setCeilingRecipients(
      options.api,
      { policy: policy.value, recipients: addressesOf(recipients) },
      { authorize: authorize.value, expiresAtMs: options.clock.now() + nowExpiryMs, signal },
    );
    if (!set.ok) {
      return err(refusalOf(set.error));
    }
  }
  return ok(undefined);
}

async function signRecipients(
  options: Options,
  { ownerKey, changes, untilMs }: SignRecipientsRequest,
  signal: AbortSignal,
): Promise<Result<SignedCeilingChange, CeilingRefusal>> {
  const authorize = await ownerOf(options, ownerKey, signal);
  if (!authorize.ok) {
    return authorize;
  }
  const signed: SignedRecipients[] = [];
  for (const { ceiling, from, to } of changes) {
    const policy = policyOf(ceiling);
    if (!policy.ok) {
      return policy;
    }
    const target = { policy: policy.value, from: addressesOf(from), to: addressesOf(to) };
    // oxlint-disable-next-line eslint/no-await-in-loop -- the owner signs one ceiling at a time
    const one = await signCeilingRecipients(options.api, target, {
      authorize: authorize.value,
      expiresAtMs: untilMs,
      signal,
    });
    if (!one.ok) {
      return err(refusalOf(one.error));
    }
    signed.push(one.value);
  }
  return ok({ untilMs, payload: jsonValueSchema.parse(signed) });
}

async function sendSigned(
  options: Options,
  change: SignedCeilingChange,
  signal: AbortSignal,
): Promise<Result<void, SignedChangeRefusal>> {
  signal.throwIfAborted();
  const parsed = payloadSchema.safeParse(change.payload);
  if (!parsed.success) {
    return err("changed");
  }
  for (const signed of parsed.data) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one ceiling at a time: a refusal stops the rest
    const sent = await sendSignedRecipients(options.api, signed, { signal });
    if (!sent.ok) {
      return sent;
    }
  }
  return ok(undefined);
}

/**
 * The {@link CeilingEditor} on the owner's Privy app (decision 0110): it reads a ceiling back from
 * its policy's rules with the app secret alone. To change one it reads the owner key from its
 * code, checks it is the key that owns the install's ceilings, and changes each ceiling's send
 * rules through Privy, signed with it. The key is used for the one request and kept nowhere.
 * Every account is listed by its address on every chain the ceiling enables.
 */
export function createPrivyCeilingEditor(options: PrivyCeilingEditorOptions): CeilingEditor {
  return {
    read: async (ceiling, { signal }) => read(options, ceiling, signal),
    setRecipients: async (request, { signal }) => setRecipients(options, request, signal),
    signRecipients: async (request, { signal }) => signRecipients(options, request, signal),
    sendSigned: async (change, { signal }) => sendSigned(options, change, signal),
  };
}
