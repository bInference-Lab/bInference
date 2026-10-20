import type { Clock } from "@binference/core";
import type { AgentRecord } from "../agents/agent-record.js";
import { noticeSettingsOf } from "../notices/notice-settings.js";
import type { AgentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { dailyNotice, isIdle } from "./daily-notice.js";
import type { DailySummaryRecord } from "./daily-summary-record.js";
import type { DailySummaryStore } from "./ports.js";
import { type SummaryFactsParts, summaryFactsOf } from "./read-summary-facts.js";
import { summaryDueOn } from "./summary-due.js";

/** What the daily summaries read, keep and tell the owner through. */
export interface DailySummaryOptions extends SummaryFactsParts {
  readonly agents: Pick<AgentStore, "list" | "get">;
  readonly summaries: DailySummaryStore;
  /** `owner.timezone` now, read at each run (decision 0118). */
  readonly ownerTimeZone: () => string;
  readonly clock: Clock;
  readonly publish: PublishPush;
}

/** The engine's daily summaries: each run sends those whose time came today. */
export interface DailySummaries {
  run(options: { readonly signal: AbortSignal }): Promise<void>;
}

const dayMs = 86_400_000;

interface Run {
  readonly nowMs: number;
  readonly timeZone: string;
  readonly signal: AbortSignal;
}

// The agent's settings and its summary before today's, once today's is due and none of today or a
// later date is stored; none before that.
async function dueOf(options: DailySummaryOptions, agent: AgentRecord, run: Run) {
  const { nowMs, timeZone, signal } = run;
  const settings = await options.agents.get(agent.id, { signal });
  if (settings === undefined) {
    return undefined;
  }
  const time = noticeSettingsOf(settings.agent.notifications).dailySummaryTime;
  const due = summaryDueOn(nowMs, timeZone, time);
  const before = await options.summaries.latest(agent.id, { signal });
  const isTaken = before !== undefined && before.date >= due.date;
  return nowMs < due.dueAtMs || isTaken ? undefined : { settings, date: due.date, before };
}

// One agent's summary of today, once due; claimed before it is told, so a stop between the two
// loses it rather than sends it twice.
async function summarize(options: DailySummaryOptions, agent: AgentRecord, run: Run) {
  const { nowMs, signal } = run;
  const due = await dueOf(options, agent, run);
  if (due === undefined) {
    return;
  }
  const { settings, date, before } = due;
  const facts = await summaryFactsOf(options, { settings, fromMs: nowMs - dayMs, nowMs, signal });
  const idle = isIdle(facts, before);
  const { live, paper } = facts;
  const record: DailySummaryRecord = {
    agentId: agent.id,
    date,
    atMs: nowMs,
    outcome: idle ? "idle" : "sent",
    ...(live.totalUsdMicros === undefined ? {} : { liveUsdMicros: live.totalUsdMicros }),
    ...(paper.totalUsdMicros === undefined ? {} : { paperUsdMicros: paper.totalUsdMicros }),
  };
  const claimed = await options.summaries.claim(record, { signal });
  if (claimed.ok && !idle) {
    const named = { id: agent.id, name: agent.name };
    const earlier = before === undefined ? {} : { before };
    options.publish(noticePush(dailyNotice({ agent: named, facts, nowMs, ...earlier })));
  }
}

/**
 * Creates the daily summaries (decision 0273). Each run takes every agent not archived: once the
 * time of day its notice settings name, on the wall clock of `owner.timezone` now, has come on
 * today's date, and no summary of today or a later date is stored, it reads the agent's last 24
 * hours, stores the summary of today with its totals, and publishes `notice.daily` unless the
 * agent was idle. A summary the engine missed while it was off goes out at the next run of the
 * same date, and never after it. A summary is information only: it starts no turn and moves no
 * money. One agent's failure leaves the others to run; the first is thrown once all ran.
 */
export function createDailySummaries(options: DailySummaryOptions): DailySummaries {
  return {
    async run({ signal }) {
      const run = { nowMs: options.clock.now(), timeZone: options.ownerTimeZone(), signal };
      const agents = await options.agents.list({ signal });
      const settled: PromiseSettledResult<void>[] = [];
      for (const agent of agents.filter(({ archivedAtMs }) => archivedAtMs === undefined)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one agent at a time, in order
        settled.push(...(await Promise.allSettled([summarize(options, agent, run)])));
      }
      const failed = settled.find(
        (one: Readonly<PromiseSettledResult<void>>): one is PromiseRejectedResult =>
          one.status === "rejected",
      );
      if (failed !== undefined) {
        throw failed.reason;
      }
    },
  };
}
