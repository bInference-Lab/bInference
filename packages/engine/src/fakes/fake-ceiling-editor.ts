import { type AccountRef, accountRefSchema } from "@binference/chain";
import { type Clock, err, jsonValueSchema, ok, type Result, type Secret } from "@binference/core";
import { z } from "zod";
import type {
  CeilingRefusal,
  CeilingRecipients,
  SignedCeilingChange,
  SignedChangeRefusal,
} from "../install/ceiling-change.js";
import type { CeilingEditor } from "../ports.js";
import { memoryCall } from "./memory-call.js";

/** The owner key code the fake ceiling editor takes; any other code is another key. */
export const fakeOwnerKeyCode = "bnok1fakeo wnerk eyfor tests only";

/** A ceiling editor in memory, whose ceilings a test sets up and reads. */
export interface FakeCeilingEditor extends CeilingEditor {
  /** What a ceiling lists now, sorted; undefined for one the fake does not hold. */
  recipients(ceiling: string): readonly AccountRef[] | undefined;
  /** Holds a ceiling that lists these recipients, as `binference init` leaves one. */
  put(ceiling: string, recipients: readonly AccountRef[]): void;
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

/**
 * Creates the {@link FakeCeilingEditor}: ceilings in memory, owned by {@link fakeOwnerKeyCode}.
 * A change signed ahead carries its changes in its payload, and expires by the clock.
 */
export function createFakeCeilingEditor(options: { readonly clock: Clock }): FakeCeilingEditor {
  const ceilings: Ceilings = new Map();
  return {
    recipients: (ceiling) => {
      const held = ceilings.get(ceiling);
      return held === undefined ? undefined : sorted(held);
    },
    put: (ceiling, recipients) => {
      ceilings.set(ceiling, sorted(recipients));
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
  };
}
