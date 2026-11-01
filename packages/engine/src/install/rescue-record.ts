import { type AccountRef, accountRefParts, accountRefSchema } from "@binference/chain";
import { idSchema, type Id } from "@binference/core";
import { z } from "zod";
import { type PendingRescue, type RescueState, rescueAt } from "../policy/rescue-change.js";
import { epochMsSchema } from "../records/record-fields.js";
import { type SignedCeilingChange, signedCeilingChangeSchema } from "./ceiling-change.js";

/** Parses a new rescue address that waits for its time. */
export const pendingRescueSchema: z.ZodType<PendingRescue> = z.strictObject({
  address: accountRefSchema,
  atMs: epochMsSchema,
});

/** Parses the install's rescue address and the new one that waits. */
const rescueStateSchema: z.ZodType<RescueState> = z.strictObject({
  rescueAddress: accountRefSchema.exactOptional(),
  pendingRescue: pendingRescueSchema.exactOptional(),
});

/**
 * The ceiling changes the owner key signed ahead for a new rescue address that waits (decision
 * 0110): one that leaves the old address out once the new one takes effect, and one that leaves
 * the new address out if the owner cancels. A change is absent when there is nothing to send.
 */
export interface RescueCeiling {
  readonly onEffect?: SignedCeilingChange;
  readonly onCancel?: SignedCeilingChange;
}

/** Parses the ceiling changes kept for a new rescue address. */
export const rescueCeilingSchema: z.ZodType<RescueCeiling> = z.strictObject({
  onEffect: signedCeilingChangeSchema.exactOptional(),
  onCancel: signedCeilingChangeSchema.exactOptional(),
});

/**
 * A request for a new rescue address at `atMs`, with the ceiling changes kept for it when it starts
 * to wait.
 */
export interface RescueAddressChange {
  readonly address: AccountRef;
  readonly atMs: number;
  readonly ceiling?: RescueCeiling;
}

/** Parses a request for a new rescue address. */
export const rescueAddressChangeSchema: z.ZodType<RescueAddressChange> = z.strictObject({
  address: accountRefSchema,
  atMs: epochMsSchema,
  ceiling: rescueCeilingSchema.exactOptional(),
});

/** The rescue address and the one that waits, in effect before a write and after it. */
export interface RescueMove {
  readonly before: RescueState;
  readonly after: RescueState;
}

/** Parses a rescue move. */
export const rescueMoveSchema: z.ZodType<RescueMove> = z.strictObject({
  before: rescueStateSchema,
  after: rescueStateSchema,
});

/** A cancel of a new rescue address, and the ceiling changes kept for the address it dropped. */
export interface RescueCancel extends RescueMove {
  readonly dropped?: RescueCeiling;
}

/** Parses a rescue cancel. */
export const rescueCancelSchema: z.ZodType<RescueCancel> = z.strictObject({
  before: rescueStateSchema,
  after: rescueStateSchema,
  dropped: rescueCeilingSchema.exactOptional(),
});

/**
 * What the store keeps of the ceiling changes after a rescue move: those of the request when a new
 * address starts to wait, none when no address waits, and the kept ones when the same address
 * still waits. The SQLite store and the fake both write this.
 */
export function rescueCeilingAfter(
  move: RescueMove,
  kept: { readonly stored?: RescueCeiling; readonly asked?: RescueCeiling },
): RescueCeiling | undefined {
  const { pendingRescue } = move.after;
  if (pendingRescue === undefined) {
    return undefined;
  }
  return pendingRescue.atMs === move.before.pendingRescue?.atMs ? kept.stored : kept.asked;
}

/**
 * Where a rescue address stands in one agent's bridge rules on one destination (decision 0321):
 * `joined` when they list it and it is in effect, `waiting` when they list it and it waits for its
 * time, `room` when it passed its plain-wallet check but the chain's list had no room, and `code`,
 * `unread` or `kind` when the check left it out: code on either chain, a chain it could not read,
 * or a chain whose addresses are of another kind.
 */
export type RescueReachState = "joined" | "waiting" | "room" | "code" | "unread" | "kind";

/** One agent's standing of one rescue address on one destination, as last told the owner. */
export interface RescueReachRecord {
  readonly agent: Id<"agt">;
  /** The rescue address on the destination chain. */
  readonly account: AccountRef;
  readonly state: RescueReachState;
}

/** Parses a rescue address's standing in one agent's bridge rules. */
export const rescueReachRecordSchema: z.ZodType<RescueReachRecord> = z.strictObject({
  agent: idSchema("agt"),
  account: accountRefSchema,
  state: z.enum(["joined", "waiting", "room", "code", "unread", "kind"]),
});

/** Parses the rescue addresses' standings: at least one, one per agent and account. */
export const rescueReachSchema: z.ZodType<readonly RescueReachRecord[]> = z
  .array(rescueReachRecordSchema)
  .min(1)
  .max(1024)
  .refine(
    (records: readonly RescueReachRecord[]) =>
      new Set(records.map((record) => `${record.agent} ${record.account}`)).size === records.length,
  );

/** The standings of the rescue addresses for some agents, which replace theirs. */
export interface RescueReachChange {
  /** The agents whose standings the change replaces; every other agent's stay. */
  readonly agents: readonly Id<"agt">[];
  /** The new standings, each of an agent the change names. */
  readonly records: readonly RescueReachRecord[];
  /** When the change is kept: the rescue addresses in effect and waiting then decide what stays. */
  readonly atMs: number;
}

/** Parses a change of the rescue addresses' standings. */
export const rescueReachChangeSchema: z.ZodType<RescueReachChange> = z.strictObject({
  agents: z.array(idSchema("agt")).max(1024),
  records: z.array(rescueReachRecordSchema).max(1024),
  atMs: epochMsSchema,
});

const addressOf = (account: AccountRef): string => accountRefParts(account).address.toLowerCase();

/**
 * The standings after a change, as the store keeps them (decision 0321): the change's agents'
 * standings replaced by its own, every other agent's kept, and each standing whose address is
 * neither the rescue address in effect at the change's time nor the one that waits forgotten.
 */
export function reachAfter(
  held: readonly RescueReachRecord[],
  change: { readonly reach: RescueReachChange; readonly rescue: RescueState },
): readonly RescueReachRecord[] {
  const { reach } = change;
  const rescue = rescueAt(change.rescue, reach.atMs);
  const homes = new Set(
    [rescue.rescueAddress, rescue.pendingRescue?.address].flatMap((address) =>
      address === undefined ? [] : [addressOf(address)],
    ),
  );
  const named = new Set(reach.agents);
  return [
    ...held.filter((record) => !named.has(record.agent)),
    ...reach.records.filter((record) => named.has(record.agent)),
  ].filter((record) => homes.has(addressOf(record.account)));
}

/** Keeps where each rescue address stands in each agent's bridge rules (decision 0321). */
export interface RescueReachStore {
  /**
   * In one transaction, replaces the standings of the agents the change names and keeps every
   * other agent's, then forgets each standing whose address is neither the rescue address in effect
   * at the change's time nor the one that waits, as the store holds them then. A setup, which sets a rescue address of its own,
   * forgets every standing.
   */
  keepRescueReach(
    change: RescueReachChange,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}
