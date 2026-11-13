import { BinferenceError, type Clock, type Id } from "@binference/core";
import type { ModelUsageStore } from "../billing/ports.js";
import type { CreatedIntent } from "../intents/created-intent.js";
import type { IntentKind } from "../intents/intent-kind.js";
import type { IntentStore, QuotaSource } from "../ports.js";
import type { Quotas } from "./quotas.js";
import { type RateRoom, rateRoom, rateWindowMs } from "./rate-room.js";

/** What the install's quota checks read: the quota source, the stored intents and model calls. */
export interface InstallQuotaParts {
  readonly source: QuotaSource;
  readonly intents: Pick<IntentStore, "createdSince">;
  readonly usage: Pick<ModelUsageStore, "turnsSince">;
  readonly clock: Clock;
}

interface QuotaCallOptions {
  readonly signal: AbortSignal;
}

/**
 * The install's quotas as the engine's use cases ask them (decision 0431). A quota with no number
 * counts nothing: no store is read for it.
 */
export interface InstallQuotas {
  /** The install's quotas now; rejects when they cannot be read, and the caller stores nothing. */
  read(call: QuotaCallOptions): Promise<Quotas>;
  /**
   * Answers the quotas it read once one more proposal of the agent's fits, or throws
   * `quota.proposals`, retryable, with `details.resumesAt` when one more fits again. It counts the
   * agent's intents stored in the last 60 seconds, but fills, rescues, unfreezes and revokes, and
   * never refuses a rescue, an unfreeze or a revoke.
   */
  proposing(
    proposal: { readonly agent: Id<"agt">; readonly kind: IntentKind },
    call: QuotaCallOptions,
  ): Promise<Quotas>;
  /**
   * Resolves once one more turn of the agent fits, or throws `quota.turns`, retryable, with
   * `details.resumesAt`. It counts the agent's turns and helper runs that called a model in the
   * last 60 seconds, each once however many calls it made.
   */
  starting(agent: Id<"agt">, call: QuotaCallOptions): Promise<void>;
}

/** The part of a proposal's options that asks the install's proposal quota; none when absent. */
export interface ProposalQuotaParts {
  readonly quotas?: Pick<InstallQuotas, "proposing">;
}

// What the proposal quota never counts or refuses: the money a rescue or a revoke keeps safe, and
// the owner's unfreeze.
const braking: ReadonlySet<IntentKind> = new Set(["rescue", "unfreeze", "revokeApproval"]);

// Whether a stored intent counts toward its agent's proposals: an auto order's or a webhook rule's
// fill, which the engine proposes, and a braking kind never do.
function isProposal(intent: CreatedIntent): boolean {
  return intent.proposer !== "engine" && !braking.has(intent.kind);
}

function throwIfFull(
  room: RateRoom,
  refused: { readonly code: "quota.proposals" | "quota.turns"; readonly agent: Id<"agt"> },
): void {
  if (room.fits) {
    return;
  }
  const { code, agent } = refused;
  const resumes = room.resumesAt === undefined ? {} : { resumesAt: room.resumesAt };
  throw new BinferenceError({
    code,
    message: `Agent ${agent} reached its quota for this minute (${code}).`,
    retryable: true,
    details: { agent, ...resumes },
  });
}

/** Creates the install's quota checks over the quota source and the stores they count. */
export function createInstallQuotas(parts: InstallQuotaParts): InstallQuotas {
  const read = async (call: QuotaCallOptions) => parts.source.read(call);
  // The window holds what is younger than a minute: one stored a full minute ago has left it.
  const fromMs = () => parts.clock.now() - rateWindowMs + 1;
  return {
    read,
    async proposing({ agent, kind }, call) {
      const quotas = await read(call);
      const quota = quotas.proposalsPerMinute;
      if (quota === undefined || braking.has(kind)) {
        return quotas;
      }
      const stored = await parts.intents.createdSince({ agentId: agent, fromMs: fromMs() }, call);
      const times = stored.filter(isProposal).map(({ createdAtMs }) => createdAtMs);
      throwIfFull(rateRoom(times, quota), { code: "quota.proposals", agent });
      return quotas;
    },
    async starting(agent, call) {
      const quota = (await read(call)).turnsPerMinute;
      if (quota === undefined) {
        return;
      }
      const turns = await parts.usage.turnsSince({ agent, fromMs: fromMs() }, call);
      const times = turns.map(({ lastAtMs }) => lastAtMs);
      throwIfFull(rateRoom(times, quota), { code: "quota.turns", agent });
    },
  };
}
