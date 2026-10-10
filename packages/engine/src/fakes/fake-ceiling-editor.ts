import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  type ChainRef,
  type ChainRegistry,
} from "@binference/chain";
import { type Clock, err, jsonValueSchema, ok, type Result, type Secret } from "@binference/core";
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

/** What a ceiling lets a contract call do: the contracts it may reach and its native cap. */
export interface FakeCalls {
  readonly contracts: readonly AccountRef[];
  readonly perTxNativeBase: bigint;
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
  const policy = jsonValueSchema.parse({
    contracts: [...contracts],
    perTxNativeBase: String(perTxNativeBase),
    recipients: [...recipients],
  });
  return { chains: chainsOf(recipients), contracts, perTxNativeBase, recipients, policy };
}

/** The ceilings and calls the fake holds, and the registry its venues' contracts come from. */
interface Held {
  readonly ceilings: Ceilings;
  readonly calls: Map<string, FakeCalls>;
  readonly chains?: ChainRegistry;
}

// A venue's contracts on a chain: the registry's, or without one the account named after it.
function contractsOn(
  held: Held,
  chain: ChainRef,
  venues: readonly string[],
): readonly AccountRef[] {
  const listed = held.chains?.list().find((item) => item.ref === chain)?.definition.contracts;
  const addresses =
    listed === undefined
      ? venues
      : listed.filter((item) => venues.includes(item.venue)).map((item) => item.address);
  return [...new Set(addresses)].map((address) => accountRefSchema.parse(`${chain}:${address}`));
}

// Each ceiling's calls, all checked before any changes: on each of its chains, a contract or more.
function setCalls(held: Held, request: CallsRequest): Result<void, CallsRefusal> {
  if (!isOwner(request.ownerKey)) {
    return err("bad_owner_key");
  }
  const changes = new Map<string, FakeCalls>();
  for (const { ceiling, venues, perTxNativeBase } of request.ceilings) {
    const recipients = held.ceilings.get(ceiling);
    if (recipients === undefined) {
      return err("not_found");
    }
    const each = chainsOf(recipients).map((chain) => contractsOn(held, chain, venues));
    if (each.some((contracts) => contracts.length === 0)) {
      return err("no_calls");
    }
    changes.set(ceiling, { contracts: each.flat(), perTxNativeBase });
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
