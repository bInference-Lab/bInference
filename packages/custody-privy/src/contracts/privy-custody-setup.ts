import assert from "node:assert/strict";
import {
  accountRefSchema,
  type Signer,
  type SignerProcess,
  type SignRequest,
  type UnsignedTx,
} from "@binference/chain";
import {
  decodeEvmTransaction,
  encodeEvmTransaction,
  type EvmChain,
  parseEvmAddress,
} from "@binference/chain-evm";
import { type Clock, err, type Id, idSchema, ok, type Result } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { buildCeiling } from "../ceiling/build-ceiling.js";
import type { Ceiling, ChainCaps } from "../ceiling/ceiling.js";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import { readCeiling } from "../ceiling/read-ceiling.js";
import type { PrivyApi } from "../privy/privy-api.js";
import { isPrivyId } from "../privy/privy-records.js";
import { createPrivyOwnerSigner, type PrivyWallet } from "../signing/privy-owner-signer.js";
import { privyTransaction } from "../signing/privy-transaction.js";
import {
  testCapPlan,
  testCaps,
  testCeilingRequest,
  testChain,
  testLaunchCeilingRequest,
} from "../testing/custody-fixtures.js";
import { withCreateCall } from "../testing/launchpad-fixtures.js";
import { createAgentWallet } from "../wallets/create-agent-wallet.js";
import { createDayCaps } from "../wallets/create-day-caps.js";
import type { WalletExpectation } from "../wallets/read-back.js";
import type { OwnerAuthorize } from "../wallets/rule-plans.js";

/** A Privy app under test, with the keys the suite makes a wallet for. */
export interface PrivyCustodySubject {
  readonly api: PrivyApi;
  /** The signer that holds the agent key. */
  readonly signerProcess: SignerProcess;
  /** A signer whose key no wallet of the suite names. */
  readonly strangerProcess: SignerProcess;
  /** The owner key's public half, DER SubjectPublicKeyInfo in base64. */
  readonly ownerKey: string;
  /** Signs a request as the owner key. */
  readonly ownerAuthorize: OwnerAuthorize;
  /** The time Privy checks a request's expiry against. */
  readonly clock: Clock;
}

/**
 * Gives the {@link PrivyCustodySubject} of each check. A harness on a live app gives the same
 * subject each time, so the suite makes one wallet in all.
 */
export interface PrivyCustodyHarness {
  create(): PrivyCustodySubject;
}

/** The wallet the suite made, and what it asked for. */
export interface CustodySetup {
  readonly subject: PrivyCustodySubject;
  readonly wallet: PrivyWallet;
  readonly expected: WalletExpectation;
  readonly agentWallet: Id<"wal">;
  /** The `privy-owner` adapter over the wallet, with the agent key. */
  readonly signer: Signer;
}

/** One transaction of a check, as the venue host would build it. */
export interface TestCall {
  readonly to: string;
  readonly valueWei: bigint;
  readonly data: `0x${string}`;
}

/** A live signal for one call, cut off after a minute. */
export const live = (): { readonly signal: AbortSignal } => ({
  signal: AbortSignal.timeout(60_000),
});

const uuid = "0190f1c2-3b4c-7d5e-8f60-718293a4b5c6";
const agentWallet = idSchema("wal").parse(`wal_${uuid}`);
const launchWallet = idSchema("wal").parse("wal_0190f1c2-3b4c-7d5e-8f60-718293a4b5c7");

/** The test ceiling, built with the caps given: by default ones no Privy app holds. */
export function testCeiling(caps: ChainCaps = testCaps): Ceiling {
  const ceiling = buildCeiling(testCeilingRequest(caps));
  assert.ok(ceiling.ok);
  return ceiling.value;
}

/** The caps a setup's wallet was made with, read from its ceiling. */
export function heldCapsOf(setup: CustodySetup): ChainCaps {
  const [held] = readCeiling(setup.expected.ceiling.rules.map(policyRuleJson))?.caps ?? [];
  assert.ok(held !== undefined);
  return held.caps;
}

// A wallet under the ceiling given, owned by the owner key with the agent key as its one signer,
// read back, and the `privy-owner` adapter over it as the engine's wallet given.
async function walletUnder(
  subject: PrivyCustodySubject,
  made: {
    readonly ceiling: (caps: ChainCaps) => Ceiling;
    readonly caps: ChainCaps;
    readonly id: Id<"wal">;
  },
): Promise<CustodySetup> {
  const { api, signerProcess, ownerKey } = subject;
  const agentKey = await signerProcess.publicKey(live());
  const ownerQuorum = await api.createKeyQuorum(
    { publicKey: ownerKey, displayName: "binference test owner" },
    live(),
  );
  const signerQuorum = await api.createKeyQuorum(
    { publicKey: agentKey, displayName: "binference test agent" },
    live(),
  );
  const expected = { ownerKey, agentKey, ceiling: made.ceiling(made.caps) };
  const created = await createAgentWallet(
    api,
    { ownerQuorum: ownerQuorum.id, signerQuorum: signerQuorum.id, expected },
    live(),
  );
  assert.ok(created.ok, `The read-back failed: ${created.ok ? "" : created.error}`);
  const wallet = created.value;
  const signer = createPrivyOwnerSigner({
    api,
    signerProcess,
    walletOf: (id) => (id === made.id ? wallet : undefined),
  });
  return { subject, wallet, expected, agentWallet: made.id, signer };
}

async function makeWallet(subject: PrivyCustodySubject): Promise<CustodySetup> {
  const { api, ownerKey } = subject;
  const owner = await api.createKeyQuorum(
    { publicKey: ownerKey, displayName: "binference test owner" },
    live(),
  );
  const caps = await createDayCaps(api, { plans: [testCapPlan], owner: owner.id }, live());
  assert.ok(caps.ok && caps.value[0] !== undefined, "Privy made no aggregations for the caps.");
  madeCaps.set(
    subject,
    caps.value.flatMap((chain) => [chain.native, ...chain.approvals].map((cap) => cap.aggregation)),
  );
  return walletUnder(subject, { ceiling: testCeiling, caps: caps.value[0], id: agentWallet });
}

// The test ceiling of a launch wallet (decision 0217), with the caps given.
// The launch wallet's ceiling: the test ceiling with its launch rules and a launchpad's create call,
// which only a launch wallet's ceiling allows (decision 0271).
function testLaunchCeiling(caps: ChainCaps): Ceiling {
  const built = buildCeiling(withCreateCall(testLaunchCeilingRequest(caps)));
  assert.ok(built.ok);
  return built.value;
}

// A launch wallet beside the suite's wallet: the test ceiling with the launch rules, under the
// same 24-hour caps, so the suite makes no more aggregations.
async function makeLaunchWallet(subject: PrivyCustodySubject): Promise<CustodySetup> {
  const caps = heldCapsOf(await setUp(subject));
  return walletUnder(subject, { ceiling: testLaunchCeiling, caps, id: launchWallet });
}

const setups = new WeakMap<PrivyCustodySubject, Promise<CustodySetup>>();
// The aggregations each subject's setup made, which the cleanup deletes: an app keeps 10.
const madeCaps = new WeakMap<PrivyCustodySubject, readonly string[]>();

// How long a cleanup's delete stays valid on Privy once the owner signs it.
const removalLifetimeMs = 5 * 60_000;

/**
 * Deletes the aggregations the suite made for a subject, once its checks are done, so runs on a
 * live app never use up its 10. The owner key the suite made owns each one, so it signs each
 * delete. An aggregation already gone is no fault; a delete Privy refuses is.
 */
export async function tearDown(subject: PrivyCustodySubject): Promise<void> {
  for (const aggregation of madeCaps.get(subject) ?? []) {
    assert.ok(isPrivyId(aggregation));
    const removal = {
      aggregation,
      authorize: subject.ownerAuthorize,
      expiresAtMs: subject.clock.now() + removalLifetimeMs,
    };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one delete at a time, as every write
    const deleted = await subject.api.deleteAggregation(removal, live());
    assert.ok(
      deleted.ok || deleted.error === "not_found",
      `Privy refused to delete ${aggregation}.`,
    );
  }
  madeCaps.delete(subject);
}

/** The suite's wallet for a subject, made on first use. */
export async function setUp(subject: PrivyCustodySubject): Promise<CustodySetup> {
  const known = setups.get(subject);
  if (known !== undefined) {
    return known;
  }
  const made = makeWallet(subject);
  setups.set(subject, made);
  return made;
}

const launchSetups = new WeakMap<PrivyCustodySubject, Promise<CustodySetup>>();

/** The suite's launch wallet for a subject, beside its wallet, made on first use. */
export async function setUpLaunch(subject: PrivyCustodySubject): Promise<CustodySetup> {
  const known = launchSetups.get(subject);
  if (known !== undefined) {
    return known;
  }
  const made = makeLaunchWallet(subject);
  launchSetups.set(subject, made);
  return made;
}

/** A type 2 call from the wallet on a chain, at nonce 0 with fixed fees. */
export function unsignedCall(
  setup: CustodySetup,
  call: TestCall,
  chain: EvmChain = testChain,
): UnsignedTx {
  const from = parseEvmAddress(setup.wallet.address);
  const to = parseEvmAddress(call.to);
  assert.ok(from.ok && to.ok);
  return encodeEvmTransaction(chain, {
    from: from.value,
    to: to.value,
    value: call.valueWei,
    data: call.data,
    nonce: 0,
    gas: 200_000n,
    fees: { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n },
  });
}

const intent = idSchema("int").parse(`int_${uuid}`);
const termsHash = "0".repeat(64);

/** A request for the adapter: one call, approved by a confirmation, allowing the call's target. */
export function signRequest(setup: CustodySetup, tx: UnsignedTx, call: TestCall): SignRequest {
  return {
    wallet: setup.agentWallet,
    intent,
    step: { index: 0, chain: tx.chain, action: { kind: "call", nativeValue: call.valueWei } },
    authorization: {
      kind: "confirmation",
      id: idSchema("cnf").parse(`cnf_${uuid}`),
      intent,
      termsHash,
      // Lasts until 2100: the suite runs on the fake's clock and on the live app's.
      expiresAtMs: 4_102_444_800_000,
    },
    termsHash,
    allowed: {
      contracts: [accountRefSchema.parse(`${tx.chain}:${call.to}`)],
      spenders: [],
      recipients: [],
    },
    tx,
  };
}

/** Where a check asks Privy directly: the call, its chain, and the signer that authorizes it. */
export interface DirectAsk {
  readonly call: TestCall;
  readonly chain?: EvmChain;
  readonly signerProcess?: SignerProcess;
}

/**
 * Asks Privy itself, past the adapter's own checks: the call goes to Privy as the adapter would
 * send it, with an authorization from the given signer, so only Privy decides.
 */
export async function askPrivy(
  setup: CustodySetup,
  ask: DirectAsk,
): Promise<Result<string, "refused" | "unknown_wallet">> {
  const { api } = setup.subject;
  const tx = unsignedCall(setup, ask.call, ask.chain);
  const decoded = decodeEvmTransaction(tx);
  assert.ok(decoded.ok);
  const signing = signRequest(setup, tx, ask.call);
  const account = accountRefSchema.parse(`${tx.chain}:${setup.wallet.address}`);
  const signerProcess = ask.signerProcess ?? setup.subject.signerProcess;
  return api.signTransaction(
    {
      wallet: setup.wallet.id,
      transaction: privyTransaction(decoded.value),
      authorize: async (request, signal) => {
        const answer = await signerProcess.authorize(
          {
            wallet: { id: signing.wallet, custodyId: setup.wallet.id, account },
            request,
            intent: signing.intent,
            step: signing.step,
            authorization: signing.authorization,
            termsHash: signing.termsHash,
            allowed: signing.allowed,
          },
          { signal },
        );
        return answer.ok ? ok(answer.value) : err("refused");
      },
    },
    live(),
  );
}

/** A check of the custody contract on the suite's wallet for the harness's subject. */
export function check(
  harness: PrivyCustodyHarness,
  name: string,
  run: (setup: CustodySetup) => Promise<void>,
): ContractCheck {
  return { name, run: async () => run(await setUp(harness.create())) };
}
