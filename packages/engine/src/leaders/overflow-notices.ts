import type { AccountRef } from "@binference/chain";
import type { Clock, Id } from "@binference/core";
import { addressPartOf, shortAddress } from "@binference/i18n";
import type { AlertStore } from "../alerts/ports.js";
import { copyLeaderOf, trackingOrderStates } from "../orders/copy-leader.js";
import type { OrderStore } from "../orders/ports.js";
import type { AgentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import type { TrackedWalletStore } from "./ports.js";

/** The message key of the notice of a tracked wallet's cut blocks (spec 4, section 4). */
export const walletOverflowNoticeKey = "notice.walletOverflow";

/** What the notices of cut blocks read and where they go. */
export interface OverflowNoticeParts {
  readonly trackedWallets: Pick<TrackedWalletStore, "overflowsToTell">;
  readonly alerts: Pick<AlertStore, "list">;
  readonly orders: Pick<OrderStore, "list">;
  readonly agents: Pick<AgentStore, "get">;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

const dayMs = 86_400_000;
// The wallets told in one call; the rest wait for the next.
const walletsPerCall = 50;
// The most alerts and orders read to find who tracks a wallet.
const trackersRead = 1_000;

// The agents that track a wallet now: by an active wallet alert, or a live copy order.
async function trackersOf(
  parts: OverflowNoticeParts,
  signal: AbortSignal,
): Promise<ReadonlyMap<AccountRef, readonly Id<"agt">[]>> {
  const [alerts, orders] = await Promise.all([
    parts.alerts.list({ states: ["active"], kind: "wallet", limit: trackersRead }, { signal }),
    parts.orders.list({ states: trackingOrderStates, limit: trackersRead }, { signal }),
  ]);
  const named = [
    ...alerts.flatMap(({ condition, agentId }) =>
      condition.kind === "wallet" ? [[condition.account, agentId] as const] : [],
    ),
    ...orders.flatMap(({ request, agentId }) => {
      const leader = copyLeaderOf(request);
      return leader === undefined ? [] : [[leader, agentId] as const];
    }),
  ];
  const trackers = new Map<AccountRef, Id<"agt">[]>();
  for (const [account, agentId] of named) {
    trackers.set(account, [...(trackers.get(account) ?? []), agentId]);
  }
  return trackers;
}

// A wallet as the notice names it: a label from the address book of an agent that tracks it, the
// first agent's first, else its short address.
async function walletText(
  parts: OverflowNoticeParts,
  watch: { readonly account: AccountRef; readonly agents: readonly Id<"agt">[] },
  signal: AbortSignal,
): Promise<string> {
  const books = await Promise.all(
    watch.agents.map(async (agentId) => (await parts.agents.get(agentId, { signal }))?.addressBook),
  );
  const entry = books
    .flatMap((book) => book ?? [])
    .find(({ account }) => account === watch.account);
  return entry?.label ?? shortAddress(addressPartOf(watch.account));
}

/**
 * Tells the owner of each tracked wallet's cut blocks (decision 0250): `notice.walletOverflow`,
 * at most once a day a wallet, naming it and how many of its blocks were cut since its last
 * notice. The store marks each told in the write that answers it, so it is told once. Answers how
 * many it told. Rejects with the signal's reason once it aborts.
 */
export async function tellOverflows(
  parts: OverflowNoticeParts,
  call: { readonly signal: AbortSignal },
): Promise<number> {
  const { signal } = call;
  const query = { atMs: parts.clock.now(), everyMs: dayMs, limit: walletsPerCall };
  const due = await parts.trackedWallets.overflowsToTell(query, { signal });
  if (due.length === 0) {
    return 0;
  }
  const trackers = await trackersOf(parts, signal);
  const told = await Promise.all(
    due.map(async ({ account, blocks }) => {
      const agents = trackers.get(account) ?? [];
      const wallet = await walletText(parts, { account, agents }, signal);
      return noticePush({
        key: walletOverflowNoticeKey,
        values: { wallet, blocks: String(blocks) },
      });
    }),
  );
  told.forEach((push) => parts.publish(push));
  return told.length;
}
