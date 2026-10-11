import type { ChainRef, ChainRegistry } from "@binference/chain";
import { type Clock, createSecret, err, jsonValueSchema, ok, type Result } from "@binference/core";
import {
  type CeilingChanges,
  type CeilingView,
  ceilingViewSchema,
  type ProtocolErrorCode,
} from "@binference/protocol";
import { z } from "zod";
import type { AgentSettings } from "../agents/agent-record.js";
import { authorOf, journalConfigChange } from "../audit/journal-config-change.js";
import type { CallsRefusal, CeilingCalls, CeilingRead } from "../install/ceiling-change.js";
import type { WalletRecord } from "../install/install-record.js";
import type { CeilingEditor } from "../install/ports.js";
import { unknownVenues } from "../limits/limit-ceiling.js";
import { activeAgent } from "../operations/active-agent.js";
import { answererOf, type EngineCall } from "../operations/engine-call.js";
import type { AgentStore, ConfigJournal, InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { type CeilingChangeKind, ceilingChangeNotice } from "./ceiling-notice.js";
import { ceilingViewOf, venuesIn } from "./ceiling-view-of.js";

/** What a ceiling change reads, asks custody, writes, journals and announces through. */
export interface SetCeilingOptions {
  readonly agents: AgentStore;
  readonly install: InstallStore;
  readonly ceilings: CeilingEditor;
  readonly journal: ConfigJournal;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

/** A live wallet of the agent, and its ceiling as custody held it at `readAt`. */
interface HeldCeiling {
  readonly wallet: WalletRecord;
  readonly read: CeilingRead;
  readonly readAt: number;
}

type Call = EngineCall<"ceiling/set">;

const refusalCodes: Readonly<Record<CallsRefusal, ProtocolErrorCode>> = {
  bad_owner_key: "wallet.bad_owner_key",
  not_found: "wallet.not_found",
  no_calls: "protocol.bad_args",
};

// Each wallet's ceiling as custody holds it now; one custody does not hold is left out.
async function readAll(
  options: SetCeilingOptions,
  wallets: readonly WalletRecord[],
  signal: AbortSignal,
): Promise<readonly HeldCeiling[]> {
  const held: HeldCeiling[] = [];
  for (const wallet of wallets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- custody reads one ceiling at a time
    const read = await options.ceilings.read(wallet.policyId, { signal });
    if (read.ok) {
      held.push({ wallet, read: read.value, readAt: options.clock.now() });
    }
  }
  return held;
}

function isCapsChange(changes: CeilingChanges): boolean {
  return changes.dayCapUsdMicros !== undefined;
}

// 24-hour caps come alone, above 0.
function capsRefusal(changes: CeilingChanges): ProtocolErrorCode | undefined {
  const { chains, venues, perTxNative, dayCapUsdMicros = 0n } = changes;
  const isAlone = chains === undefined && venues === undefined && perTxNative === undefined;
  return isAlone && dayCapUsdMicros > 0n ? undefined : "protocol.bad_args";
}

function lowerSet(items: readonly string[]): ReadonlySet<string> {
  return new Set(items.map((item) => item.toLowerCase()));
}

function isSameSet(left: readonly string[], right: readonly string[]): boolean {
  const [a, b] = [lowerSet(left), lowerSet(right)];
  return a.size === b.size && [...a].every((item) => b.has(item));
}

// A chain change, venues none or unknown, a venue removed that the limits in effect or waiting
// still name, or 24-hour caps that are not above 0 or come with another change; undefined when
// the changes may apply to every ceiling.
function refusalOf(
  options: SetCeilingOptions,
  planned: {
    readonly changes: CeilingChanges;
    readonly held: readonly HeldCeiling[];
    readonly settings: AgentSettings;
  },
): ProtocolErrorCode | undefined {
  const { changes, held, settings } = planned;
  const { chains, venues } = changes;
  if (isCapsChange(changes)) {
    return capsRefusal(changes);
  }
  const isChainChange = (enabled: readonly ChainRef[]) =>
    chains !== undefined && !isSameSet(enabled, chains);
  if (held.some((item) => isChainChange(item.read.chains))) {
    return "protocol.bad_args";
  }
  if (venues === undefined) {
    return undefined;
  }
  if (venues.length === 0 || unknownVenues(options.chains, venues).length > 0) {
    return "protocol.bad_args";
  }
  const { limits } = settings;
  const named = new Set([...limits.venues, ...(limits.pending?.values.venues ?? [])]);
  const removed = held.flatMap((item) =>
    venuesIn(options.chains, item.read).filter((venue) => !venues.includes(venue)),
  );
  return removed.some((venue) => named.has(venue)) ? "limit.venue_in_use" : undefined;
}

// What each ceiling's calls become: the venues, cap and 24-hour caps asked, else the ones it holds.
function callsOf(
  options: SetCeilingOptions,
  changes: CeilingChanges,
  held: readonly HeldCeiling[],
): readonly CeilingCalls[] {
  const { dayCapUsdMicros } = changes;
  // A ceiling that allows no call names no cap, so a change of the caps leaves it as it is.
  const changed =
    dayCapUsdMicros === undefined ? held : held.filter(({ read }) => read.dayCaps.length > 0);
  const resize = dayCapUsdMicros === undefined ? {} : { dayCapUsdMicros };
  return changed.map(({ wallet, read }) =>
    Object.assign(
      {
        ceiling: wallet.policyId,
        venues: [...new Set(changes.venues ?? venuesIn(options.chains, read))],
        perTxNativeBase: changes.perTxNative ?? read.perTxNativeBase,
      },
      resize,
    ),
  );
}

// Each wallet's stored copy of its ceiling, as custody holds it after the change.
async function refresh(
  options: SetCeilingOptions,
  wallets: readonly WalletRecord[],
  signal: AbortSignal,
): Promise<readonly HeldCeiling[]> {
  const after = await readAll(options, wallets, signal);
  for (const { wallet, read, readAt } of after) {
    const { policy, perTxNativeBase } = read;
    const ceiling = { policyId: wallet.policyId, policy, perTxNativeBase, readAtMs: readAt };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet's copy at a time
    await options.install.updateCeiling({ wallet: wallet.id, ceiling }, { signal });
  }
  return after;
}

/** One ceiling as custody held it before a change and after. */
interface ReadPair {
  readonly earlier: CeilingRead;
  readonly next: CeilingRead;
}

function limitsOf(caps: CeilingRead["dayCaps"]): string {
  return caps.map((cap) => `${cap.asset} ${cap.limit}`).join(",");
}

// What moved between the reads before and after: the contracts a call may reach, the cap, both.
function kindOf(
  before: readonly HeldCeiling[],
  after: readonly HeldCeiling[],
): CeilingChangeKind | undefined {
  const pairs = after.flatMap((next): readonly ReadPair[] => {
    const earlier = before.find((item) => item.wallet.id === next.wallet.id);
    return earlier === undefined ? [] : [{ earlier: earlier.read, next: next.read }];
  });
  const caps = pairs.some(
    ({ earlier, next }) => limitsOf(earlier.dayCaps) !== limitsOf(next.dayCaps),
  );
  if (caps) {
    return "dayCaps";
  }
  const venues = pairs.some(({ earlier, next }) => !isSameSet(earlier.contracts, next.contracts));
  const cap = pairs.some(({ earlier, next }) => earlier.perTxNativeBase !== next.perTxNativeBase);
  if (venues && cap) {
    return "both";
  }
  if (venues || cap) {
    return venues ? "venues" : "cap";
  }
  return undefined;
}

function wireOf(options: SetCeilingOptions, held: readonly HeldCeiling[]) {
  const views = held.map((item) =>
    z.encode(ceilingViewSchema, ceilingViewOf(options.chains, { ...item, wallet: item.wallet.id })),
  );
  return jsonValueSchema.parse(views);
}

// A change that moved a ceiling is journaled, pushed as `config/changed`, and announced.
async function announce(
  options: SetCeilingOptions,
  moved: { readonly call: Call; readonly settings: AgentSettings },
  reads: { readonly before: readonly HeldCeiling[]; readonly after: readonly HeldCeiling[] },
): Promise<void> {
  const kind = kindOf(reads.before, reads.after);
  if (kind === undefined) {
    return;
  }
  const { call, settings } = moved;
  const surface = answererOf(call.caller).surface;
  await journalConfigChange(
    options,
    {
      author: authorOf(call.caller),
      atMs: options.clock.now(),
      path: `agents.${settings.agent.name}.ceiling`,
      before: wireOf(options, reads.before),
      after: wireOf(options, reads.after),
      notices: [ceilingChangeNotice(settings.agent, { surface, kind })],
    },
    { signal: call.signal },
  );
}

// The live wallet the call names, its agent, and every live wallet of that agent.
async function walletsOf(
  options: SetCeilingOptions,
  call: Call,
): Promise<
  Result<
    { readonly settings: AgentSettings; readonly wallets: readonly WalletRecord[] },
    ProtocolErrorCode
  >
> {
  const { wallets } = await options.install.read({ signal: call.signal });
  const live = wallets.filter((wallet) => wallet.archivedAtMs === undefined);
  const named = live.find((wallet) => wallet.id === call.args.wallet);
  if (named === undefined) {
    return err("wallet.not_found");
  }
  const found = await activeAgent(options.agents, named.agentId, { signal: call.signal });
  // The 24-hour caps are the install's: a change of them reaches every live wallet.
  const changed = isCapsChange(call.args.changes)
    ? live
    : live.filter((wallet) => wallet.agentId === named.agentId);
  return found.ok ? ok({ settings: found.value, wallets: changed }) : found;
}

/**
 * Changes what the ceiling of every live wallet of an agent lets a contract call do, with the
 * owner key over IPC (decision 0132): the venues whose registry contracts it may reach and the
 * most native coin one call may carry, on the chains each ceiling enables. A change of the 24-hour
 * caps comes alone, above 0, and resizes the caps of every live wallet of the install, whose sums
 * they share (decision 0151); any other is `protocol.bad_args`. Its chains and
 * recipients stay: naming other chains is `protocol.bad_args`, as a new chain needs a new wallet.
 * No venue or an unknown one is `protocol.bad_args`; removing a venue the agent's limits name, in
 * effect or waiting, is `limit.venue_in_use`; a wrong key is `wallet.bad_owner_key`. Each wallet's
 * stored copy of its ceiling is then read back from custody; a change that moved one is
 * journaled, pushed as `config/changed`, and announced as the `notice.ceilingChange` notice. It
 * answers the named wallet's ceiling as custody holds it after the change.
 */
export async function setCeiling(
  options: SetCeilingOptions,
  call: Call,
): Promise<Result<CeilingView, ProtocolErrorCode>> {
  const { args, signal } = call;
  const found = await walletsOf(options, call);
  if (!found.ok) {
    return found;
  }
  const { settings, wallets } = found.value;
  const before = await readAll(options, wallets, signal);
  if (before.length < wallets.length) {
    return err("wallet.not_found");
  }
  const refusal = refusalOf(options, { changes: args.changes, held: before, settings });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const ceilings = callsOf(options, args.changes, before);
  const set = await options.ceilings.setCalls(
    { ownerKey: createSecret(args.ownerKey), ceilings },
    { signal },
  );
  if (!set.ok && set.error === "bad_owner_key") {
    return err(refusalCodes[set.error]);
  }
  // A refusal part way may leave earlier ceilings changed: every copy is read back all the same.
  const after = await refresh(options, wallets, signal);
  await announce(options, { call, settings }, { before, after });
  const named = after.find((item) => item.wallet.id === args.wallet);
  if (!set.ok || named === undefined) {
    return err(set.ok ? "wallet.not_found" : refusalCodes[set.error]);
  }
  return ok(ceilingViewOf(options.chains, { ...named, wallet: named.wallet.id }));
}
