import type { Id } from "@binference/core";
import { type LiveFactsView, liveFactsViewSchema, type WorkspaceFile } from "@binference/protocol";
import type { ContextSource } from "../relay/ports.js";
import type { SkillIndexEntry } from "../relay/skill-index-entry.js";

/** A {@link ContextSource} held in memory, which a test edits as the owner would. */
export interface MemoryContextSource extends ContextSource {
  /** Writes one of an agent's workspace files, or removes it with `undefined`. */
  write(agent: Id<"agt">, file: WorkspaceFile, text: string | undefined): void;
  /** Sets the skills an agent's index holds, in place of those before. */
  setSkills(agent: Id<"agt">, skills: readonly SkillIndexEntry[]): void;
  /** Makes every read reject from now on, as an engine out of reach does, or answer again. */
  link(state: "up" | "down"): void;
  /** How many times the live facts were read. */
  factReads(): number;
}

/** Live facts of a paper agent with 1 BNB on BNB Smart Chain, read at the time given. */
export function testLiveFacts(agent: Id<"agt">, at: number): LiveFactsView {
  const bnb = "eip155:56/slip44:714";
  return liveFactsViewSchema.parse({
    agent,
    at,
    timeZone: "UTC",
    mode: "paper",
    frozen: false,
    approvalMode: "manual",
    sendLevel: 0,
    balances: [
      {
        wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001",
        amount: { asset: bnb, base: "1000000000000000000" },
        usdMicros: "600000000",
        paper: true,
      },
    ],
    totalUsdMicros: "600000000",
    orders: [],
    spentTodayUsdMicros: "25000000",
    perTradeUsdMicros: "100000000",
    rollingDayUsdMicros: "500000000",
    assets: { [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true } },
  });
}

/** Whom a {@link MemoryContextSource} answers for, and its time. */
export interface MemoryContextSourceOptions {
  /** The agents it holds; every agent when absent. */
  readonly agents?: readonly Id<"agt">[];
  /** The time the facts are read at; 10:00:10 UTC on 1 January 2026 when absent. */
  readonly now?: () => number;
}

/**
 * Creates a {@link MemoryContextSource} with no workspace file and no skill, whose live facts are
 * {@link testLiveFacts} read at the time `now` gives. An agent it does not hold rejects.
 */
export function createMemoryContextSource(
  options: MemoryContextSourceOptions = {},
): MemoryContextSource {
  const { agents, now = () => 1_767_261_610_000 } = options;
  const files = new Map<string, string>();
  const skills = new Map<Id<"agt">, readonly SkillIndexEntry[]>();
  const state = { down: false, reads: 0 };
  const reach = (agent: Id<"agt">, signal: AbortSignal): void => {
    signal.throwIfAborted();
    if (state.down || (agents !== undefined && !agents.includes(agent))) {
      throw new Error("The engine cannot answer for this agent.");
    }
  };
  return {
    async workspaceFile(place, signal) {
      reach(place.agent, signal);
      return await Promise.resolve(files.get(`${place.agent}/${place.file}`));
    },
    async skills(agent, signal) {
      reach(agent, signal);
      return await Promise.resolve(skills.get(agent) ?? []);
    },
    async liveFacts(agent, signal) {
      reach(agent, signal);
      state.reads += 1;
      return await Promise.resolve(testLiveFacts(agent, now()));
    },
    write(agent, file, text) {
      const key = `${agent}/${file}`;
      if (text === undefined) {
        files.delete(key);
      } else {
        files.set(key, text);
      }
    },
    setSkills(agent, entries) {
      skills.set(agent, entries);
    },
    link: (link) => {
      state.down = link === "down";
    },
    factReads: () => state.reads,
  };
}
