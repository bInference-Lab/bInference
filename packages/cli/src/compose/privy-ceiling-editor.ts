import { type ChainRef, chainRefSchema } from "@binference/chain";
import {
  BinferenceError,
  type Clock,
  err,
  jsonValueSchema,
  ok,
  type Result,
} from "@binference/core";
import {
  type CeilingChain,
  type CeilingChainPlan,
  type CeilingHeld,
  type ChainCapPlan,
  createDayCaps,
  type HeldCaps,
  isPrivyId,
  readCeiling,
  type PrivyApi,
  type PrivyId,
  type PrivyPolicy,
  type RecipientsRefusal,
  sendSignedRecipients,
  planCeilingRecipients,
  type PlannedEdits,
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
import { callsRefusalOf } from "./calls-refusal.js";
import { type GrownCaps, planCappedCalls } from "./capped-calls.js";
import { type CeilingAddressParts, ceilingAddressesOf } from "./ceiling-addresses.js";
import { ownerAuthorize, type OwnerKeyHolder } from "./owner-authorize.js";
import { writeEveryPlan } from "./planned-writes.js";
import { privyCeilingRead } from "./privy-ceiling-read.js";
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
  /** How each account becomes the addresses a ceiling lists for its own chain (decision 0313). */
  readonly addresses: CeilingAddressParts;
}

// A change signed now goes out at once; five minutes covers every ceiling of an install.
const nowExpiryMs = 5 * 60_000;

const payloadSchema = z.array(signedRecipientsSchema);

function policyOf(ceiling: string): Result<PrivyId, "not_found"> {
  return isPrivyId(ceiling) ? ok(ceiling) : err("not_found");
}

function refusalOf(error: RecipientsRefusal): CeilingRefusal {
  if (error === "malformed_address" || error === "too_many_addresses") {
    return "bad_recipients";
  }
  if (error === "too_large") {
    return error;
  }
  return error === "refused" ? "bad_owner_key" : "not_found";
}

type Options = PrivyCeilingEditorOptions;

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
  return ok(privyCeilingRead(held.value, options.capAssetsOn));
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
  const planned: PlannedEdits[] = [];
  for (const { ceiling, recipients } of ceilings) {
    const policy = policyOf(ceiling);
    if (!policy.ok) {
      return policy;
    }
    // Every write derives each destination's bridge recipients from the same accounts (decision
    // 0302), so a removed address stops being paid on every chain in one change.
    const addresses = ceilingAddressesOf(recipients, options.addresses);
    const target = { policy: policy.value, recipients: addresses, bridged: addresses };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one ceiling at a time: a refusal stops the rest
    const one = await planCeilingRecipients(options.api, target, { signal });
    if (!one.ok) {
      return err(refusalOf(one.error));
    }
    planned.push(one.value);
  }
  const expiresAtMs = options.clock.now() + nowExpiryMs;
  const input = { authorize: authorize.value, expiresAtMs, signal };
  const written = await writeEveryPlan(options.api, planned, input);
  return written.ok ? written : err(refusalOf(written.error));
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
    const target = {
      policy: policy.value,
      from: ceilingAddressesOf(from, options.addresses),
      to: ceilingAddressesOf(to, options.addresses),
    };
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

// Each chain's plan with its 24-hour caps: of those the ceiling and the install's ceilings name,
// the ones with the most token caps, since every ceiling of an install shares them and a token cap
// joins at the end (decision 0305); else new ones its owner's quorum owns, as Privy keeps 10
// aggregations an app.
async function cappedChains(
  options: Options,
  target: { readonly held: Held; readonly plans: readonly CeilingChainPlan[] },
  signal: AbortSignal,
): Promise<readonly CeilingChain[]> {
  const known = [...target.held.rules.caps, ...(await options.heldCaps(signal))];
  const capsOn = (plan: CeilingChainPlan) =>
    known
      .filter((item) => item.chainId === String(plan.chain.chainId))
      .toSorted((left, right) => right.caps.approvals.length - left.caps.approvals.length)[0]?.caps;
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
// The caps a ceiling of the change made serve the next ones.
async function planOne(
  options: Options,
  change: { readonly calls: CeilingCalls; readonly grown: GrownCaps },
  signal: AbortSignal,
): Promise<Result<PlannedEdits, CallsRefusal>> {
  const { calls, grown } = change;
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
    return err(calls.role === "bridge" ? "no_bridge_calls" : "no_calls");
  }
  const capped = await cappedChains(options, { held: held.value, plans }, signal);
  const dayUsdMicros = calls.dayCapUsdMicros;
  const chains = withDayCaps(capped, { dayUsdMicros, capPlanOn: options.capPlanOn });
  const target = { policy: policy.value, chains, owner: held.value.policy.ownerId };
  const capPlanOn = (chain: ChainRef) => options.capPlanOn(chain, dayUsdMicros);
  const planned = await planCappedCalls(target, { api: options.api, signal, capPlanOn, grown });
  return planned.ok ? planned : err(callsRefusalOf(planned.error));
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
  const grown: GrownCaps = new Map();
  const planned: PlannedEdits[] = [];
  for (const calls of ceilings) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one ceiling at a time: a refusal stops the rest
    const one = await planOne(options, { calls, grown }, signal);
    if (!one.ok) {
      return one;
    }
    planned.push(one.value);
  }
  const expiresAtMs = options.clock.now() + nowExpiryMs;
  const input = { authorize: authorize.value, expiresAtMs, signal };
  const written = await writeEveryPlan(options.api, planned, input);
  return written.ok ? written : err(callsRefusalOf(written.error));
}

/**
 * The {@link CeilingEditor} on the owner's Privy app (decision 0110): it reads a ceiling back from
 * its policy's rules with the app secret alone. To change one it reads the owner key from its
 * code, checks it is the key that owns the install's ceilings, and changes each ceiling's send
 * rules, or its contract-call and approval rules (decision 0132) with the 24-hour caps they
 * compare (decision 0151), through Privy, signed with it.
 * The key is used for the one request and kept nowhere. Every account is listed by its recipient
 * bytes for its own chain alone (decision 0313).
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
