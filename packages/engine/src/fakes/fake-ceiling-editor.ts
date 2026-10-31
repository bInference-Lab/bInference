import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRef,
  type ChainRegistry,
  type VenueContracts,
  type VenueDeclaration,
} from "@binference/chain";
import { type Clock, err, jsonValueSchema, ok, type Result, type Secret } from "@binference/core";
import type { DayCapView } from "@binference/protocol";
import { z } from "zod";
import type {
  CallsRefusal,
  CallsRequest,
  CeilingRead,
  CeilingRefusal,
  CeilingRecipients,
  SignedCeilingChange,
  SignedChangeRefusal,
} from "../install/ceiling-change.js";
import type { CeilingEditor } from "../install/ports.js";
import { memoryCall } from "./memory-call.js";

/** The owner key code the fake ceiling editor takes; any other code is another key. */
export const fakeOwnerKeyCode = "bnok1fakeo wnerk eyfor tests only";

/**
 * What a ceiling lets a contract call do: the contracts it may reach, its native cap, and the
 * 24-hour caps it names, none unless given.
 */
export interface FakeCalls {
  readonly contracts: readonly AccountRef[];
  readonly perTxNativeBase: bigint;
  readonly dayCaps?: readonly DayCapView[];
  /** The functions a launch wallet's ceiling lets a call reach on any contract; none if absent. */
  readonly launchCalls?: readonly string[];
  /** The functions its call rules let a call reach on their contracts; none if absent. */
  readonly functions?: readonly string[];
}

/** A ceiling editor in memory, whose ceilings a test sets up and reads. */
export interface FakeCeilingEditor extends CeilingEditor {
  /** What a ceiling lists now, sorted; undefined for one the fake does not hold. */
  recipients(ceiling: string): readonly AccountRef[] | undefined;
  /**
   * Holds a ceiling that lists these recipients, as `binference init` leaves one; it lets a call
   * reach no contract and carry one coin, unless `calls` says otherwise.
   */
  put(ceiling: string, recipients: readonly AccountRef[], calls?: FakeCalls): void;
}

interface FakeChange {
  readonly ceiling: string;
  readonly from: readonly AccountRef[];
  readonly to: readonly AccountRef[];
}

const changesSchema: z.ZodType<readonly FakeChange[]> = z.array(
  z.strictObject({
    ceiling: z.string(),
    from: z.array(accountRefSchema),
    to: z.array(accountRefSchema),
  }),
);

function sorted(accounts: readonly AccountRef[]): readonly AccountRef[] {
  return [...new Set(accounts)].toSorted();
}

function isSame(left: readonly AccountRef[], right: readonly AccountRef[]): boolean {
  return sorted(left).join(" ") === sorted(right).join(" ");
}

function isOwner(ownerKey: Secret): boolean {
  return ownerKey.reveal() === fakeOwnerKeyCode;
}

type Ceilings = Map<string, readonly AccountRef[]>;

// A ceiling the fake holds, listing at least one recipient, as Privy's `in` takes one or more.
function refusalOf(ceilings: Ceilings, wanted: CeilingRecipients): CeilingRefusal | undefined {
  if (!ceilings.has(wanted.ceiling)) {
    return "not_found";
  }
  return wanted.recipients.length === 0 ? "bad_recipients" : undefined;
}

function setAll(
  ceilings: Ceilings,
  request: { readonly ownerKey: Secret; readonly ceilings: readonly CeilingRecipients[] },
): Result<void, CeilingRefusal> {
  const refusal = isOwner(request.ownerKey)
    ? request.ceilings.map((item) => refusalOf(ceilings, item)).find((item) => item !== undefined)
    : "bad_owner_key";
  if (refusal !== undefined) {
    return err(refusal);
  }
  for (const item of request.ceilings) {
    ceilings.set(item.ceiling, sorted(item.recipients));
  }
  return ok(undefined);
}

function sendAll(
  ceilings: Ceilings,
  change: SignedCeilingChange,
  nowMs: number,
): Result<void, SignedChangeRefusal> {
  if (change.untilMs < nowMs) {
    return err("expired");
  }
  const changes = changesSchema.parse(change.payload);
  for (const item of changes) {
    const held = ceilings.get(item.ceiling);
    if (held === undefined) {
      return err("not_found");
    }
    if (!isSame(held, item.from) && !isSame(held, item.to)) {
      return err("changed");
    }
  }
  for (const item of changes) {
    ceilings.set(item.ceiling, sorted(item.to));
  }
  return ok(undefined);
}

const oneCoin: FakeCalls = { contracts: [], perTxNativeBase: 10n ** 18n };

function chainsOf(recipients: readonly AccountRef[]): readonly ChainRef[] {
  return [...new Set(recipients.map((account) => accountRefParts(account).chain))];
}

// A held ceiling as custody reads it: the chains of its recipients, and what its calls may do.
function readOf(recipients: readonly AccountRef[], calls: FakeCalls): CeilingRead {
  const { contracts, perTxNativeBase } = calls;
  // Each function rides in the policy as a JSON ABI entry with no inputs, as a call rule holds it.
  const policy = jsonValueSchema.parse({
    contracts: [...contracts],
    perTxNativeBase: String(perTxNativeBase),
    recipients: [...recipients],
    functions: (calls.functions ?? []).map((name) => ({ type: "function", name, inputs: [] })),
  });
  const dayCaps = calls.dayCaps ?? [];
  const launchCalls = calls.launchCalls ?? [];
  const functions = calls.functions ?? [];
  const chains = chainsOf(recipients);
  return {
    chains,
    contracts,
    perTxNativeBase,
    recipients,
    dayCaps,
    launchCalls,
    functions,
    policy,
  };
}

/** The ceilings and calls the fake holds, and the registry its venues' contracts come from. */
interface Held {
  readonly ceilings: Ceilings;
  readonly calls: Map<string, FakeCalls>;
  readonly chains?: ChainRegistry;
  readonly venues?: readonly VenueDeclaration[];
  readonly functionsOf?: FakeCeilingEditorOptions["functionsOf"];
}

// The names a venue's entry on a chain puts in a ceiling, as custody's read-back counts them: each
// contract a plain call or a call of the wallet's role reaches, and each spender of the role. A
// bridge deposit is left out: it holds a rule only once a destination has a saved address, which
// the fake never has. An entry that declares no calls puts all its names in.
function namesIn(entry: VenueContracts, role: "launch" | undefined): readonly string[] {
  if (entry.calls === undefined) {
    return entry.names;
  }
  const called = entry.calls
    .filter((call) => call.bridge === undefined)
    .filter((call) => call.onlyWallet === undefined || call.onlyWallet === role)
    .map((call) => call.contract);
  const roleSpenders = role === undefined ? [] : (entry.onlyWalletSpenders?.[role] ?? []);
  return [...called, ...(entry.spenders ?? []), ...roleSpenders];
}

// A venue's contracts on a chain: the registry's that its declaration puts in a ceiling, or without
// a registry the account named after it.
function contractsOn(
  held: Held,
  chain: ChainRef,
  ceiling: { readonly venues: readonly string[]; readonly isLaunch: boolean },
): readonly AccountRef[] {
  const { venues, isLaunch } = ceiling;
  const listed = held.chains?.list().find((item) => item.ref === chain)?.definition.contracts;
  const counts = (venue: string, name: string): boolean => {
    const entries = held.venues?.find((item) => item.id === venue)?.contracts ?? [];
    const entry = entries.find((item) => item.chain === chain);
    return entry === undefined || namesIn(entry, isLaunch ? "launch" : undefined).includes(name);
  };
  const addresses =
    listed === undefined
      ? venues
      : listed
          .filter((item) => venues.includes(item.venue) && counts(item.venue, item.name))
          .map((item) => item.address);
  return [...new Set(addresses)].map((address) => accountRefSchema.parse(`${chain}:${address}`));
}

// Each cap at the size asked: its limit scaled from its old size in dollars, rounded up.
function resized(
  dayCaps: readonly DayCapView[] | undefined,
  usdMicros: bigint | undefined,
): readonly DayCapView[] | undefined {
  if (dayCaps === undefined || usdMicros === undefined) {
    return dayCaps;
  }
  return dayCaps.map((cap) => {
    const { limit, floorUsdMicros } = cap;
    const scaled =
      floorUsdMicros === 0n ? limit : (limit * usdMicros + floorUsdMicros - 1n) / floorUsdMicros;
    return { ...cap, limit: scaled, floorUsdMicros: usdMicros };
  });
}

// Each ceiling's calls, all checked before any changes: on each of its chains, a contract or more.
function setCalls(held: Held, request: CallsRequest): Result<void, CallsRefusal> {
  if (!isOwner(request.ownerKey)) {
    return err("bad_owner_key");
  }
  const changes = new Map<string, FakeCalls>();
  for (const { ceiling, venues, perTxNativeBase, dayCapUsdMicros, isLaunch } of request.ceilings) {
    const recipients = held.ceilings.get(ceiling);
    if (recipients === undefined) {
      return err("not_found");
    }
    const at = { venues, isLaunch: isLaunch === true };
    const each = chainsOf(recipients).map((chain) => contractsOn(held, chain, at));
    if (each.some((contracts) => contracts.length === 0)) {
      return err("no_calls");
    }
    const dayCaps = resized(held.calls.get(ceiling)?.dayCaps, dayCapUsdMicros);
    const kept = dayCaps === undefined ? {} : { dayCaps };
    const functions = held.functionsOf?.(venues, { isLaunch: isLaunch === true }) ?? [];
    changes.set(ceiling, { contracts: each.flat(), perTxNativeBase, ...kept, functions });
  }
  for (const [ceiling, calls] of changes) {
    held.calls.set(ceiling, calls);
  }
  return ok(undefined);
}

/** What the fake ceiling editor keeps time by, and where its venues' contracts come from. */
export interface FakeCeilingEditorOptions {
  readonly clock: Clock;
  /**
   * The registry whose contracts a venue's are, on each chain; without one, a venue's contract
   * on a chain is the account named after the venue.
   */
  readonly chains?: ChainRegistry;
  /**
   * The venues' declarations, so a venue counts on a chain only through the contracts custody's
   * read-back names; without them, every registry contract of a venue counts.
   */
  readonly venues?: readonly VenueDeclaration[];
  /**
   * The functions a ceiling's call rules hold once a change of calls writes it for the venues
   * given, as custody writes them from the venues' declarations; none when absent.
   */
  readonly functionsOf?: (
    venues: readonly string[],
    ceiling: { readonly isLaunch: boolean },
  ) => readonly string[];
}

/**
 * Creates the {@link FakeCeilingEditor}: ceilings in memory, owned by {@link fakeOwnerKeyCode}.
 * A change signed ahead carries its changes in its payload, and expires by the clock. A change of
 * calls is checked on every ceiling before any changes.
 */
export function createFakeCeilingEditor(options: FakeCeilingEditorOptions): FakeCeilingEditor {
  const ceilings: Ceilings = new Map();
  const calls = new Map<string, FakeCalls>();
  const store: Held = {
    ceilings,
    calls,
    ...(options.chains === undefined ? {} : { chains: options.chains }),
    ...(options.venues === undefined ? {} : { venues: options.venues }),
    ...(options.functionsOf === undefined ? {} : { functionsOf: options.functionsOf }),
  };
  return {
    read: async (ceiling, call) =>
      memoryCall(call, () => {
        const held = ceilings.get(ceiling);
        return held === undefined
          ? err("not_found" as const)
          : ok(readOf(held, calls.get(ceiling) ?? oneCoin));
      }),
    recipients: (ceiling) => {
      const held = ceilings.get(ceiling);
      return held === undefined ? undefined : sorted(held);
    },
    put: (ceiling, recipients, held = oneCoin) => {
      ceilings.set(ceiling, sorted(recipients));
      calls.set(ceiling, held);
    },
    setRecipients: async (request, call) => memoryCall(call, () => setAll(ceilings, request)),
    signRecipients: async ({ ownerKey, changes, untilMs }, call) =>
      memoryCall(call, (): Result<SignedCeilingChange, CeilingRefusal> => {
        if (!isOwner(ownerKey)) {
          return err("bad_owner_key");
        }
        const payload = jsonValueSchema.parse(
          changes.map(({ ceiling, from, to }) => ({ ceiling, from: [...from], to: [...to] })),
        );
        return ok({ untilMs, payload });
      }),
    sendSigned: async (change, call) =>
      memoryCall(call, () => sendAll(ceilings, change, options.clock.now())),
    setCalls: async (request, call) => memoryCall(call, () => setCalls(store, request)),
  };
}
