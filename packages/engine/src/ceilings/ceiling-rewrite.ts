import type { ChainRegistry } from "@binference/chain";
import { type Clock, jsonValueSchema } from "@binference/core";
import { ceilingViewSchema } from "@binference/protocol";
import { z } from "zod";
import type { AgentRecord } from "../agents/agent-record.js";
import { type ConfigAuthor, journalConfigChange } from "../audit/journal-config-change.js";
import type { CeilingRead } from "../install/ceiling-change.js";
import type { WalletRecord } from "../install/install-record.js";
import type { CeilingEditor } from "../install/ports.js";
import type { ConfigJournal, InstallStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { type CeilingChangeKind, ceilingChangeNotice } from "./ceiling-notice.js";
import { ceilingViewOf } from "./ceiling-view-of.js";
import { type CeilingReads, dayCapAddedNotice } from "./day-cap-added.js";

/** What a rewrite of ceilings reads, stores, journals and announces through. */
export interface CeilingRewriteParts {
  readonly install: InstallStore;
  readonly ceilings: CeilingEditor;
  readonly journal: ConfigJournal;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

/** A live wallet, and its ceiling as custody held it at `readAt`. */
export interface HeldCeiling {
  readonly wallet: WalletRecord;
  readonly read: CeilingRead;
  readonly readAt: number;
}

/** Each wallet's ceiling as custody holds it now; one custody does not hold is left out. */
export async function readCeilings(
  parts: Pick<CeilingRewriteParts, "ceilings" | "clock">,
  wallets: readonly WalletRecord[],
  signal: AbortSignal,
): Promise<readonly HeldCeiling[]> {
  const held: HeldCeiling[] = [];
  for (const wallet of wallets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- custody reads one ceiling at a time
    const read = await parts.ceilings.read(wallet.policyId, { signal });
    if (read.ok) {
      held.push({ wallet, read: read.value, readAt: parts.clock.now() });
    }
  }
  return held;
}

/**
 * Each wallet's stored copy of its ceiling, as custody holds it after a change, even one that
 * stopped part way: the copy is what the limits read (decision 0132).
 */
export async function refreshCeilings(
  parts: Pick<CeilingRewriteParts, "ceilings" | "clock" | "install">,
  wallets: readonly WalletRecord[],
  signal: AbortSignal,
): Promise<readonly HeldCeiling[]> {
  const after = await readCeilings(parts, wallets, signal);
  for (const { wallet, read, readAt } of after) {
    const { policy, perTxNativeBase } = read;
    const ceiling = { policyId: wallet.policyId, policy, perTxNativeBase, readAtMs: readAt };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet's copy at a time
    await parts.install.updateCeiling({ wallet: wallet.id, ceiling }, { signal });
  }
  return after;
}

function lowerSet(items: readonly string[]): ReadonlySet<string> {
  return new Set(items.map((item) => item.toLowerCase()));
}

/** Whether two lists hold the same texts in any order and letter case. */
export function isSameSet(left: readonly string[], right: readonly string[]): boolean {
  const [a, b] = [lowerSet(left), lowerSet(right)];
  return a.size === b.size && [...a].every((item) => b.has(item));
}

// Each wallet's ceiling read before the change and after it.
function pairsOf(
  before: readonly HeldCeiling[],
  after: readonly HeldCeiling[],
): readonly CeilingReads[] {
  return after.flatMap((next): readonly CeilingReads[] => {
    const earlier = before.find((item) => item.wallet.id === next.wallet.id);
    return earlier === undefined ? [] : [{ earlier: earlier.read, next: next.read }];
  });
}

function limitsOf(caps: CeilingRead["dayCaps"]): string {
  return caps.map((cap) => `${cap.asset} ${cap.limit}`).join(",");
}

// What moved between the reads before and after: the contracts a call may reach, the cap, both.
function kindOf(
  before: readonly HeldCeiling[],
  after: readonly HeldCeiling[],
): CeilingChangeKind | undefined {
  const pairs = pairsOf(before, after);
  const caps = pairs.some(
    ({ earlier, next }) => limitsOf(earlier.dayCaps) !== limitsOf(next.dayCaps),
  );
  if (caps) {
    return "dayCaps";
  }
  // A new function on the same contracts, such as a launchpad's create call, moves the venues'
  // calls as much as a new contract does (decision 0271).
  const venues = pairs.some(
    ({ earlier, next }) =>
      !isSameSet(earlier.contracts, next.contracts) ||
      !isSameSet(earlier.functions, next.functions),
  );
  const cap = pairs.some(({ earlier, next }) => earlier.perTxNativeBase !== next.perTxNativeBase);
  if (venues && cap) {
    return "both";
  }
  if (venues || cap) {
    return venues ? "venues" : "cap";
  }
  return undefined;
}

function wireOf(chains: ChainRegistry, held: readonly HeldCeiling[]) {
  const views = held.map((item) =>
    z.encode(ceilingViewSchema, ceilingViewOf(chains, { ...item, wallet: item.wallet.id })),
  );
  return jsonValueSchema.parse(views);
}

/**
 * Journals and announces a rewrite of an agent's ceilings that moved one (decisions 0132 and
 * 0305): what a call may reach, its cap or the 24-hour caps, under `agents.<name>.ceiling`, with
 * the ceiling notice and, when the rewrite added a 24-hour cap, `notice.dayCapAdded`. A rewrite
 * that moved none is not journaled.
 */
export async function announceRewrite(
  parts: Pick<CeilingRewriteParts, "journal" | "publish" | "chains" | "clock">,
  moved: {
    readonly agent: AgentRecord;
    readonly author: ConfigAuthor;
    readonly signal: AbortSignal;
  },
  reads: { readonly before: readonly HeldCeiling[]; readonly after: readonly HeldCeiling[] },
): Promise<void> {
  const kind = kindOf(reads.before, reads.after);
  if (kind === undefined) {
    return;
  }
  const { agent, author, signal } = moved;
  const added = dayCapAddedNotice(agent, {
    chains: parts.chains,
    reads: pairsOf(reads.before, reads.after),
  });
  await journalConfigChange(
    parts,
    {
      author,
      atMs: parts.clock.now(),
      path: `agents.${agent.name}.ceiling`,
      before: wireOf(parts.chains, reads.before),
      after: wireOf(parts.chains, reads.after),
      notices: [
        ceilingChangeNotice(agent, { surface: author.surface, kind }),
        ...(added === undefined ? [] : [added]),
      ],
    },
    { signal },
  );
}
