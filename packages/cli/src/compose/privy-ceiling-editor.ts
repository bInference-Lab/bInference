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
} from "@binference/core";
import {
  type CallsRefusal as PrivyCallsRefusal,
  type CeilingChain,
  isPrivyId,
  type OwnerAuthorize,
  readCeiling,
  type PrivyApi,
  type PrivyId,
  type RecipientsRefusal,
  sendSignedRecipients,
  setCeilingCalls,
  setCeilingRecipients,
  signCeilingRecipients,
  signedRecipientsSchema,
  type SignedRecipients,
} from "@binference/custody-privy";
import type {
  CallsRefusal,
  CallsRequest,
  CeilingEditor,
  CeilingCalls,
  CeilingRead,
  CeilingRefusal,
  RecipientsRequest,
  SignedCeilingChange,
  SignedChangeRefusal,
  SignRecipientsRequest,
} from "@binference/engine/install";
import { z } from "zod";
import { ownerAuthorize, type OwnerKeyHolder } from "./owner-authorize.js";

/** What the Privy ceiling editor reaches Privy with, and the owner key it takes. */
export interface PrivyCeilingEditorOptions extends OwnerKeyHolder {
  readonly api: PrivyApi;
  readonly clock: Clock;
  /**
   * What a contract call may do on a chain for the venues named: call and approve their registry
   * contracts, none for venues with none there, sending at most the cap.
   */
  readonly callsOn: (chain: ChainRef, calls: Omit<CeilingCalls, "ceiling">) => CeilingChain;
}

// A change signed now goes out at once; five minutes covers every ceiling of an install.
const nowExpiryMs = 5 * 60_000;

const payloadSchema = z.array(signedRecipientsSchema);

// Privy compares addresses as text: each account's address once, in the order given.
function addressesOf(accounts: readonly AccountRef[]): readonly string[] {
  return [...new Set(accounts.map((account) => accountRefParts(account).address))];
}

function policyOf(ceiling: string): Result<PrivyId, "not_found"> {
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
    policy: jsonValueSchema.parse(held.value),
  });
}

async function setRecipients(
  options: Options,
  { ownerKey, ceilings }: RecipientsRequest,
  signal: AbortSignal,
): Promise<Result<void, CeilingRefusal>> {
  const authorize = await ownerAuthorize(options, ownerKey, signal);
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
  const authorize = await ownerAuthorize(options, ownerKey, signal);
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

function callsRefusalOf(error: PrivyCallsRefusal): CallsRefusal {
  if (error === "refused") {
    return "bad_owner_key";
  }
  if (error === "not_found") {
    return error;
  }
  // The registry's contracts and a cap the engine checked are a ceiling Privy takes.
  throw new BinferenceError({
    code: "cli.ceiling_unbuilt",
    message: "The venues give no contract calls a ceiling can have.",
    details: { problem: error },
  });
}

// One ceiling's calls on each chain it enables now; a chain the venues give no contract stops it.
async function setOne(
  options: Options,
  change: { readonly calls: CeilingCalls; readonly authorize: OwnerAuthorize },
  signal: AbortSignal,
): Promise<Result<void, CallsRefusal>> {
  const { calls, authorize } = change;
  const policy = policyOf(calls.ceiling);
  if (!policy.ok) {
    return policy;
  }
  const held = await read(options, calls.ceiling, signal);
  if (!held.ok) {
    return held;
  }
  const chains = held.value.chains.map((chain) => options.callsOn(chain, calls));
  if (chains.some((chain) => chain.contracts.length === 0)) {
    return err("no_calls");
  }
  const expiresAtMs = options.clock.now() + nowExpiryMs;
  const target = { policy: policy.value, chains };
  const set = await setCeilingCalls(options.api, target, { authorize, expiresAtMs, signal });
  return set.ok ? set : err(callsRefusalOf(set.error));
}

async function setCalls(
  options: Options,
  { ownerKey, ceilings }: CallsRequest,
  signal: AbortSignal,
): Promise<Result<void, CallsRefusal>> {
  const authorize = await ownerAuthorize(options, ownerKey, signal);
  if (!authorize.ok) {
    return authorize;
  }
  for (const calls of ceilings) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one ceiling at a time: a refusal stops the rest
    const set = await setOne(options, { calls, authorize: authorize.value }, signal);
    if (!set.ok) {
      return set;
    }
  }
  return ok(undefined);
}

/**
 * The {@link CeilingEditor} on the owner's Privy app (decision 0110): it reads a ceiling back from
 * its policy's rules with the app secret alone. To change one it reads the owner key from its
 * code, checks it is the key that owns the install's ceilings, and changes each ceiling's send
 * rules, or its contract-call and approval rules (decision 0132), through Privy, signed with it.
 * The key is used for the one request and kept nowhere. Every account is listed by its address on
 * every chain the ceiling enables.
 */
export function createPrivyCeilingEditor(options: PrivyCeilingEditorOptions): CeilingEditor {
  return {
    read: async (ceiling, { signal }) => read(options, ceiling, signal),
    setRecipients: async (request, { signal }) => setRecipients(options, request, signal),
    signRecipients: async (request, { signal }) => signRecipients(options, request, signal),
    sendSigned: async (change, { signal }) => sendSigned(options, change, signal),
    setCalls: async (request, { signal }) => setCalls(options, request, signal),
  };
}
