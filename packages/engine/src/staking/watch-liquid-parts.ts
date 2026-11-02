import { accountRefParts, type Signer } from "@binference/chain";
import type { StakingVenue, UnbondingPart } from "@binference/chain/staking";
import type { Clock, Id } from "@binference/core";
import { addressPartOf, shortAddress } from "@binference/i18n";
import { stakeQuoteDocument } from "../intents/stake-quote.js";
import type { InstallStore, IntentStore } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import type { StakingHost } from "../venues/staking-host.js";
import type { UnbondingStore } from "./ports.js";
import type { UnbondingRecord } from "./unbonding-record.js";

/** What the watch of a liquid venue's live parts reads, books and tells through. */
export interface LiquidWatchParts {
  readonly unbondings: Pick<UnbondingStore, "openOf" | "markTold" | "closeOutside">;
  readonly install: Pick<InstallStore, "read">;
  readonly intents: Pick<IntentStore, "list">;
  readonly positions: Pick<Positions, "claim">;
  readonly staking: StakingHost;
  readonly custody: Pick<Signer, "account">;
  readonly publish: PublishPush;
  readonly clock: Clock;
}

/** What one pass of the watch did: the parts it told ready and those it closed. */
export interface LiquidWatchPass {
  readonly told: number;
  readonly closed: number;
}

/** When each wallet's holding with a venue was read last, which the next passes skip a while. */
export type LiquidReads = Map<string, number>;

// A holding read within this long is not read again: Lista's queue releases once a day or so.
const rereadAfterMs = 5 * 60_000;
// The watch remembers at most this many holdings' last reads; the oldest goes first.
const maxRemembered = 1_000;
// The states of a claim that may still take a part: it was confirmed and is not booked yet.
const claimingStates = ["confirmed", "executing", "finalized"] as const;

interface Group {
  readonly key: string;
  readonly venue: StakingVenue;
  readonly wallet: Id<"wal">;
  readonly agent?: Id<"agt">;
  readonly rows: readonly UnbondingRecord[];
}

// A notice of the row's coin, naming the pool it unstaked from by its short address.
function rowNotice(key: string, row: UnbondingRecord, agent: Id<"agt"> | undefined) {
  const validator =
    row.validator === undefined ? row.venue : shortAddress(addressPartOf(row.validator));
  return noticePush({
    key,
    ...(agent === undefined ? {} : { agent }),
    values: { validator },
    amounts: { amount: row.amount },
  });
}

// The refs of the wallet's live claims that may still take a part: a claim of binference keeps
// its request out of the watch until it is booked.
async function claimingRefs(
  parts: LiquidWatchParts,
  call: { readonly signal: AbortSignal },
): Promise<ReadonlySet<string>> {
  const query = { states: [...claimingStates], isPaper: false, limit: 1_000 };
  const live = await parts.intents.list(query, call);
  const refs = live.flatMap((record) => {
    const quote =
      record.kind === "stake" && record.quote !== undefined
        ? stakeQuoteDocument.decode(record.quote)
        : undefined;
    return quote?.plan.action === "claim"
      ? (quote.plan.parts ?? []).map((ref) => `${record.walletId} ${ref}`)
      : [];
  });
  return new Set(refs);
}

// One wallet's live rows of liquid venues whose time came, one group per venue.
function walletGroups(
  parts: LiquidWatchParts,
  wallet: { readonly id: Id<"wal">; readonly agentId?: Id<"agt"> },
  open: readonly UnbondingRecord[],
): readonly Group[] {
  const nowMs = parts.clock.now();
  const byVenue = new Map<string, readonly UnbondingRecord[]>();
  for (const row of open.filter((item) => item.readyAtMs <= nowMs)) {
    byVenue.set(row.venue, [...(byVenue.get(row.venue) ?? []), row]);
  }
  return [...byVenue.keys()].flatMap((venueId): Group[] => {
    const rows = byVenue.get(venueId) ?? [];
    const [first] = rows;
    const chain =
      first?.validator === undefined ? undefined : accountRefParts(first.validator).chain;
    const venue = chain === undefined ? undefined : parts.staking.venueOn(venueId, chain);
    if (venue?.pool === undefined) {
      return [];
    }
    const agent = wallet.agentId === undefined ? {} : { agent: wallet.agentId };
    return [{ key: `${wallet.id} ${venueId}`, venue, wallet: wallet.id, ...agent, rows }];
  });
}

// Every wallet's live rows of liquid venues whose time came, one group per wallet and venue.
async function groupsOf(
  parts: LiquidWatchParts,
  call: { readonly signal: AbortSignal },
): Promise<readonly Group[]> {
  const { wallets } = await parts.install.read(call);
  const groups: Group[] = [];
  for (const wallet of wallets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet at a time keeps the reads few
    const open = await parts.unbondings.openOf({ walletId: wallet.id, isPaper: false }, call);
    groups.push(...walletGroups(parts, wallet, open));
  }
  return groups;
}

// The holding's parts as the venue reads them now; none when the wallet or the venue cannot be read.
async function partsOf(
  parts: LiquidWatchParts,
  group: Group,
  call: { readonly signal: AbortSignal },
): Promise<readonly UnbondingPart[] | undefined> {
  const account = await parts.custody.account(group.wallet, group.venue.chain, call);
  const pool = group.venue.pool;
  if (!account.ok || pool === undefined) {
    return undefined;
  }
  const held = await parts.staking.parts(
    group.venue,
    { wallet: account.value, validator: pool },
    call,
  );
  return held.ok ? held.value : undefined;
}

// A row whose request the venue no longer lists closes as claimed outside binference: its coin
// arrives at what the unstake recorded it worth, and the owner hears of it once.
async function closeGone(
  parts: LiquidWatchParts,
  gone: { readonly group: Group; readonly rows: readonly UnbondingRecord[] },
  call: { readonly signal: AbortSignal },
): Promise<number> {
  const { group, rows } = gone;
  let closed = 0;
  for (const row of rows) {
    const atMs = parts.clock.now();
    // oxlint-disable-next-line eslint/no-await-in-loop -- each close is one write, in order
    const done = await parts.unbondings.closeOutside({ id: row.id, atMs }, call);
    if (done.ok) {
      const value = row.valueUsdMicros === undefined ? {} : { valueUsdMicros: row.valueUsdMicros };
      const arrival = {
        walletId: row.walletId,
        isPaper: false,
        atMs,
        received: row.amount,
        ...value,
      };
      // oxlint-disable-next-line eslint/no-await-in-loop -- the coin books after its row closed
      await parts.positions.claim(arrival, call);
      parts.publish(rowNotice("notice.claimedElsewhere", row, group.agent));
      closed += 1;
    }
  }
  return closed;
}

async function watchGroup(
  parts: LiquidWatchParts,
  group: Group,
  context: { readonly claiming: ReadonlySet<string>; readonly signal: AbortSignal },
): Promise<LiquidWatchPass> {
  const call = { signal: context.signal };
  const held = await partsOf(parts, group, call);
  if (held === undefined) {
    return { told: 0, closed: 0 };
  }
  const nowMs = parts.clock.now();
  const listed = new Map(held.map((part) => [part.ref, part]));
  const isReleased = (part: UnbondingPart | undefined) =>
    part !== undefined && part.queued !== true && part.readyAtMs <= nowMs;
  const ready = group.rows.filter(
    (row) => row.toldReadyAtMs === undefined && isReleased(listed.get(row.requestRef)),
  );
  const gone = group.rows.filter(
    (row) =>
      !listed.has(row.requestRef) && !context.claiming.has(`${group.wallet} ${row.requestRef}`),
  );
  for (const row of ready) {
    parts.publish(rowNotice("notice.claimReady", row, group.agent));
  }
  if (ready.length > 0) {
    await parts.unbondings.markTold({ ids: ready.map((row) => row.id), atMs: nowMs }, call);
  }
  return { told: ready.length, closed: await closeGone(parts, { group, rows: gone }, call) };
}

function remember(reads: LiquidReads, key: string, atMs: number): void {
  reads.delete(key);
  reads.set(key, atMs);
  const [oldest] = reads.keys();
  if (reads.size > maxRemembered && oldest !== undefined) {
    reads.delete(oldest);
  }
}

/**
 * One pass of the watch of a liquid venue's live unbondings whose time came (decision 0331): it
 * reads each wallet's holding with the venue once, one holding at a time, and skips a holding read
 * in the last five minutes. A part the venue's queue released is told ready once
 * (`notice.claimReady`); a row whose request the venue no longer lists, and that no live claim of
 * binference names, was claimed outside binference, by the venue's own bot or on its site: it
 * closes, its coin arrives at the value its unstake recorded, and the owner is told once
 * (`notice.claimedElsewhere`). A wallet or venue that cannot be read waits for a later pass.
 */
export async function watchLiquidParts(
  parts: LiquidWatchParts,
  reads: LiquidReads,
  call: { readonly signal: AbortSignal },
): Promise<LiquidWatchPass> {
  const groups = await groupsOf(parts, call);
  const nowMs = parts.clock.now();
  const due = groups.filter(
    (group) => (reads.get(group.key) ?? -Infinity) <= nowMs - rereadAfterMs,
  );
  if (due.length === 0) {
    return { told: 0, closed: 0 };
  }
  const claiming = await claimingRefs(parts, call);
  let told = 0;
  let closed = 0;
  for (const group of due) {
    remember(reads, group.key, nowMs);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one holding at a time bounds the reads
    const pass = await watchGroup(parts, group, { claiming, signal: call.signal });
    told += pass.told;
    closed += pass.closed;
  }
  return { told, closed };
}
