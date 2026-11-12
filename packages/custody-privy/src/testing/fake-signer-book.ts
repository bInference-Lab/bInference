import type { ChainRef, SignerLock } from "@binference/chain";
import type { Id } from "@binference/core";
import { type Address, type Hex, keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type {
  ServiceOutcome,
  SignerServiceAnswer,
  SignerServiceRequest,
} from "../signing/signer-service-wire.schema.js";
import {
  askOf,
  authorizationRefusal,
  callOf,
  type FakeLease,
  type FakeServiceFacts,
  type FakeServiceIntent,
  holdsLease,
  lockedOutcome,
  refusedFor,
} from "./fake-signer-checks.js";
import {
  type FakeReservation,
  type FakeSumAsset,
  grownBy,
  isCapped,
  overSums,
  type SumsAsk,
  type SumsBook,
  windowOf,
} from "./fake-signer-sums.js";

/** What happens at Privy and at the lease's second read for one request (spec 5, 8.3). */
export type FakeAfterChecks = "privy_refuses" | "privy_app" | "lease_lost_after_sign";

/** The chain and the sums the fake keeps, and the time by its database's clock. */
export interface FakeSignerBookOptions {
  readonly now: () => number;
  readonly install: Id<"ins">;
  readonly chain: { readonly ref: ChainRef; readonly chainId: number };
  readonly native: FakeSumAsset;
  /** The tokens the chain caps, whose approvals count. */
  readonly tokens: readonly FakeSumAsset[];
  /** The deploy's dollar maximum a day, which no install's cap passes. */
  readonly maxUsd: bigint;
}

/** One request as the service took it: the worker its certificate names and its exact text. */
export interface FakeAsked {
  readonly worker: string;
  readonly text: string;
  readonly request: SignerServiceRequest;
  readonly after?: FakeAfterChecks;
}

/**
 * The install's rows and the service's own store, and the checks of spec 5, section 8.3 in its
 * order. It holds each wallet's key and signs the transaction it builds from the stored plan, so
 * what it signs is never the worker's description.
 */
export interface FakeSignerBook {
  /** Holds a new wallet's key; answers its address, checksummed. */
  addWallet(): Address;
  /** Stores an intent, or replaces the one with its id. */
  putIntent(intent: FakeServiceIntent): void;
  setLease(lease: FakeLease | undefined): void;
  pullBreaker(): void;
  liftBreaker(): void;
  /** Makes the key's read-back fail, or match again with undefined. */
  lockKey(reason: Exclude<SignerLock, "breaker"> | undefined): void;
  setRescue(address: Address): void;
  /** The install's 24-hour cap in dollars, $1,000 until set. */
  setDayCapUsd(usd: bigint): void;
  /** Stores the reservation of an earlier signature, such as one that fills the day. */
  plantReservation(reservation: Omit<FakeReservation, "id" | "state">): void;
  reservations(): readonly FakeReservation[];
  answer(asked: FakeAsked): Promise<SignerServiceAnswer>;
}

interface State {
  readonly keys: Map<string, Hex>;
  readonly intents: Map<Id<"int">, FakeServiceIntent>;
  readonly reservations: Map<number, FakeReservation>;
  readonly answers: Map<
    string,
    { readonly text: string; readonly answer: SignerServiceAnswer; readonly atMs: number }
  >;
  facts: Omit<FakeServiceFacts, "nowMs">;
  dayCapUsd: bigint;
}

/** A reservation the checks made or grew, with the one it replaced. */
interface Reserved {
  readonly reservation: FakeReservation;
  readonly before?: FakeReservation;
  readonly intent: FakeServiceIntent;
}

/** One request's place in the store's checks. */
interface Asking {
  readonly options: FakeSignerBookOptions;
  readonly state: State;
  readonly request: SignerServiceRequest;
  readonly intent: FakeServiceIntent;
}

function sumsOf({ options, state }: Pick<Asking, "options" | "state">): SumsBook {
  const { native, tokens, maxUsd } = options;
  return { chain: options.chain.ref, native, tokens, maxUsd, dayCapUsd: state.dayCapUsd };
}

function put(state: State, reservation: FakeReservation): FakeReservation {
  state.reservations.set(reservation.id, reservation);
  return reservation;
}

// The step's own reservation at its nonce, or `nonce_held` while another intent that has not
// ended holds the nonce (spec 5, section 8.4).
function heldAtNonce(
  asking: Asking,
  window: readonly FakeReservation[],
): FakeReservation | ServiceOutcome | undefined {
  const { state, request, intent } = asking;
  const account = intent.wallet.toLowerCase();
  const atNonce = window.find((held) => held.account === account && held.nonce === request.nonce);
  if (atNonce === undefined) {
    return undefined;
  }
  if (atNonce.intent === intent.id && atNonce.step === request.step) {
    return atNonce;
  }
  return state.intents.get(atNonce.intent)?.state === "ended"
    ? undefined
    : refusedFor("nonce_held");
}

function newReservation(asking: Asking, ask: SumsAsk, nowMs: number): FakeReservation {
  const { state, request, intent } = asking;
  return put(state, {
    id: state.reservations.size + 1,
    account: intent.wallet.toLowerCase(),
    nonce: request.nonce,
    intent: intent.id,
    step: request.step,
    nativeBase: ask.nativeBase,
    tokenBase: ask.approval?.amountBase ?? 0n,
    ...(ask.approval === undefined ? {} : { token: ask.approval.token }),
    state: "reserved",
    reservedAtMs: nowMs,
  });
}

// Reserves the step's sums before anything signs: a new reservation, or the step's own one grown
// for a repeat, a speed-up or its cancel. A replacement needs the step's signed one.
function reserve(asking: Asking): Reserved | ServiceOutcome {
  const { options, request, intent } = asking;
  const step = intent.steps[request.step];
  if (step === undefined) {
    return refusedFor("malformed");
  }
  const nowMs = options.now();
  const window = windowOf([...asking.state.reservations.values()], nowMs);
  const held = heldAtNonce(asking, window);
  if (held !== undefined && "outcome" in held) {
    return held;
  }
  if (request.replaces !== undefined && held?.state !== "signed") {
    return refusedFor("rule_6");
  }
  const sums = sumsOf(asking);
  const ask = askOf(step, request, (token) => isCapped(sums, token));
  const over = overSums(sums, { window, ask, nowMs, ...(held === undefined ? {} : { held }) });
  if (over !== undefined) {
    return { outcome: "over_sums", ...over };
  }
  return held === undefined
    ? { intent, reservation: newReservation(asking, ask, nowMs) }
    : { intent, reservation: put(asking.state, grownBy(held, ask)), before: held };
}

// Takes back a reservation no signature left the service under.
function release(state: State, reserved: Reserved): void {
  put(state, reserved.before ?? { ...reserved.reservation, state: "released" });
}

// Step 2 of spec 5, section 8.3 in its order, up to and with the reservation.
function checked(
  options: FakeSignerBookOptions,
  state: State,
  asked: FakeAsked,
): Reserved | ServiceOutcome {
  const { request, worker } = asked;
  const facts: FakeServiceFacts = { ...state.facts, nowMs: options.now() };
  const intent = state.intents.get(request.intent);
  const locked = lockedOutcome(facts, request, intent);
  if (locked !== undefined) {
    return locked;
  }
  if (!holdsLease(facts, request, worker)) {
    return { outcome: "lease_lost" };
  }
  if (intent?.state !== "executing") {
    return refusedFor("intent_state");
  }
  if (!state.keys.has(intent.wallet.toLowerCase())) {
    return refusedFor("unknown_wallet");
  }
  const refusal =
    authorizationRefusal(intent, request, facts.nowMs) ??
    ("gasPrice" in request.fees ? "malformed" : intent.steps[request.step]?.breaks);
  return refusal === undefined ? reserve({ options, state, request, intent }) : refusedFor(refusal);
}

async function signed(asking: Asking): Promise<ServiceOutcome> {
  const { options, state, request, intent } = asking;
  const step = intent.steps[request.step];
  const key = state.keys.get(intent.wallet.toLowerCase());
  if (step === undefined || key === undefined || "gasPrice" in request.fees) {
    return refusedFor("malformed");
  }
  const raw = await privateKeyToAccount(key).signTransaction({
    type: "eip1559",
    chainId: options.chain.chainId,
    nonce: request.nonce,
    gas: request.gasLimit,
    maxFeePerGas: request.fees.maxFeePerGas,
    maxPriorityFeePerGas: request.fees.maxPriorityFeePerGas,
    ...callOf(intent, step, request),
  });
  return { outcome: "signed", tx: { chain: options.chain.ref, raw, hash: keccak256(raw) } };
}

// Steps 3 to 5 of spec 5, section 8.3: Privy signs or refuses, the lease is read again, and only
// then is the reservation marked signed. Whatever stops it releases the reservation.
async function afterChecks(
  asking: Asking,
  asked: FakeAsked & { readonly reserved: Reserved },
): Promise<ServiceOutcome> {
  const { options, state } = asking;
  const { after, reserved } = asked;
  if (after === "privy_refuses" || after === "privy_app") {
    release(state, reserved);
    return after === "privy_app"
      ? { outcome: "locked", reason: "privy_app" }
      : refusedFor("privy_refused");
  }
  const outcome = await signed(asking);
  const facts = { ...state.facts, nowMs: options.now() };
  const isLeaseLost =
    after === "lease_lost_after_sign" || !holdsLease(facts, asked.request, asked.worker);
  if (outcome.outcome !== "signed" || isLeaseLost) {
    release(state, reserved);
    return isLeaseLost ? { outcome: "lease_lost" } : outcome;
  }
  put(state, { ...reserved.reservation, state: "signed" });
  return outcome;
}

// How long the store keeps an answer for its repeats (spec 5, section 8.7).
const answersKeptMs = 86_400_000;

// One answer per worker and request id for 24 hours (decision 0425): a repeat gets the first,
// and a repeat with another body is refused as malformed.
async function answerOnce(
  options: FakeSignerBookOptions,
  state: State,
  asked: FakeAsked,
): Promise<SignerServiceAnswer> {
  const key = `${asked.worker} ${asked.request.requestId}`;
  const header = { version: 1, requestId: asked.request.requestId } as const;
  const nowMs = options.now();
  for (const [kept, { atMs }] of state.answers) {
    if (nowMs - atMs >= answersKeptMs) {
      state.answers.delete(kept);
    }
  }
  const first = state.answers.get(key);
  if (first !== undefined) {
    return first.text === asked.text ? first.answer : { ...header, ...refusedFor("malformed") };
  }
  const reserved = checked(options, state, asked);
  const outcome =
    "outcome" in reserved
      ? reserved
      : await afterChecks(
          { options, state, request: asked.request, intent: reserved.intent },
          { ...asked, reserved },
        );
  const answer: SignerServiceAnswer = { ...header, ...outcome };
  state.answers.set(key, { text: asked.text, answer, atMs: nowMs });
  return answer;
}

/** Creates a {@link FakeSignerBook} with no wallet, no intent, no lease and the default cap. */
export function createFakeSignerBook(options: FakeSignerBookOptions): FakeSignerBook {
  const state: State = {
    keys: new Map(),
    intents: new Map(),
    reservations: new Map(),
    answers: new Map(),
    facts: {
      install: options.install,
      lease: undefined,
      isBreakerPulled: false,
      keyLock: undefined,
      rescue: undefined,
    },
    dayCapUsd: 1_000n,
  };
  const setFacts = (facts: Partial<Omit<FakeServiceFacts, "nowMs">>): void => {
    state.facts = { ...state.facts, ...facts };
  };
  return {
    addWallet() {
      const privateKey = generatePrivateKey();
      const { address } = privateKeyToAccount(privateKey);
      state.keys.set(address.toLowerCase(), privateKey);
      return address;
    },
    putIntent: (intent) => state.intents.set(intent.id, intent),
    setLease: (lease) => setFacts({ lease }),
    pullBreaker: () => setFacts({ isBreakerPulled: true }),
    liftBreaker: () => setFacts({ isBreakerPulled: false }),
    lockKey: (keyLock) => setFacts({ keyLock }),
    setRescue: (address) => setFacts({ rescue: address.toLowerCase() }),
    setDayCapUsd: (usd) => {
      state.dayCapUsd = usd;
    },
    plantReservation: (reservation) => {
      put(state, { ...reservation, id: state.reservations.size + 1, state: "signed" });
    },
    reservations: () => [...state.reservations.values()],
    answer: async (asked) => answerOnce(options, state, asked),
  };
}
