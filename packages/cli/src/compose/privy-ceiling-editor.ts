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
  type CeilingChainPlan,
  type CeilingHeld,
  type ChainCapPlan,
  createDayCaps,
  type HeldCaps,
  isPrivyId,
  type OwnerAuthorize,
  readCeiling,
  type PrivyApi,
  type PrivyId,
  type PrivyPolicy,
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
import type { CapAssets } from "../init/ceiling-request.js";
import { dayCapViewsOf } from "./day-cap-views.js";
import { ownerAuthorize, type OwnerKeyHolder } from "./owner-authorize.js";
import { withDayCaps } from "./resized-caps.js";

/** What the Privy ceiling editor reaches Privy with, and the owner key it takes. */
export interface PrivyCeilingEditorOptions extends OwnerKeyHolder {
  readonly api: PrivyApi;
  readonly clock: Clock;
  /**
   * What a contract call may do on a chain for the venues named: call and approve their registry
   * contracts, none for venues with none there, sending at most the cap.
   */
  readonly callsOn: (chain: ChainRef, calls: Omit<CeilingCalls, "ceiling">) => CeilingChainPlan;
  /**
   * The plan of a chain's 24-hour caps, each the micro-dollars given at its floor price, else as
   * init sizes them: for a ceiling that names none on the chain yet, or caps the owner resizes.
   */
  readonly capPlanOn: (chain: ChainRef, dayUsdMicros?: bigint) => ChainCapPlan;
  /** What a chain's 24-hour caps count and their floors; undefined for a chain unknown here. */
  readonly capAssetsOn: (chain: ChainRef) => CapAssets | undefined;
  /** The 24-hour caps the install's live ceilings name now. */
  readonly heldCaps: (signal: AbortSignal) => Promise<readonly HeldCaps[]>;
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

/** A ceiling's policy as Privy holds it, and its rules read. */
interface Held {
  readonly policy: PrivyPolicy;
  readonly rules: CeilingHeld;
}

async function heldOf(
  options: Options,
  ceiling: string,
  signal: AbortSignal,
): Promise<Result<Held, "not_found">> {
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
  return ok({ policy: held.value, rules });
}

async function read(
  options: Options,
  ceiling: string,
  signal: AbortSignal,
): Promise<Result<CeilingRead, "not_found">> {
  const held = await heldOf(options, ceiling, signal);
  if (!held.ok) {
    return held;
  }
  const { rules, policy } = held.value;
  const chains = rules.chainIds.map((id) => chainRefSchema.parse(`eip155:${id}`));
  return ok({
    chains,
    contracts: accountsOn(chains, rules.contracts),
    perTxNativeBase: rules.perTxNativeCapBase,
    recipients: accountsOn(chains, rules.recipients),
    dayCaps: dayCapViewsOf(rules.caps, options.capAssetsOn),
    launchCalls: rules.launchCalls,
    functions: rules.functions,
    policy: jsonValueSchema.parse(policy),
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

// Each chain's plan with its 24-hour caps: those the ceiling names, else those the install's
// ceilings name, else new ones its owner's quorum owns, as Privy keeps 10 aggregations an app.
async function cappedChains(
  options: Options,
  target: { readonly held: Held; readonly plans: readonly CeilingChainPlan[] },
  signal: AbortSignal,
): Promise<readonly CeilingChain[]> {
  const known = [...target.held.rules.caps, ...(await options.heldCaps(signal))];
  const capsOn = (plan: CeilingChainPlan) =>
    known.find((item) => item.chainId === String(plan.chain.chainId))?.caps;
  const missing = target.plans.filter((plan) => capsOn(plan) === undefined);
  const owner = target.held.policy.ownerId;
  const made =
    missing.length === 0 || owner === null
      ? ok([])
      : await createDayCaps(
          options.api,
          { plans: missing.map((plan) => options.capPlanOn(plan.chain.ref)), owner },
          { signal },
        );
  const fresh = made.ok ? [...made.value] : [];
  return target.plans.map((plan) => {
    const caps = capsOn(plan) ?? fresh.shift();
    if (caps === undefined) {
      throw new BinferenceError({
        code: "cli.ceiling_unbuilt",
        message: "The ceiling names no 24-hour caps binference can make.",
        details: { problem: made.ok ? "no_caps" : made.error },
      });
    }
    return { ...plan, caps };
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
  const held = await heldOf(options, calls.ceiling, signal);
  if (!held.ok) {
    return held;
  }
  const refs = held.value.rules.chainIds.map((id) => chainRefSchema.parse(`eip155:${id}`));
  const plans = refs.map((chain) => options.callsOn(chain, calls));
  if (plans.some((plan) => plan.calls.length === 0)) {
    return err("no_calls");
  }
  const capped = await cappedChains(options, { held: held.value, plans }, signal);
  const dayUsdMicros = calls.dayCapUsdMicros;
  const chains = withDayCaps(capped, { dayUsdMicros, capPlanOn: options.capPlanOn });
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
 * rules, or its contract-call and approval rules (decision 0132) with the 24-hour caps they
 * compare (decision 0151), through Privy, signed with it.
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
