import type { Id } from "@binference/core";
import { liveFactsViewSchema } from "@binference/protocol";
import type { ContextSource } from "@binference/runtime/testing";
import type { ScenarioWorld } from "./scenario.schema.js";
import { portfolioOf, type WorldFacts } from "./world-answers.js";

// What each turn of a scenario's run reads besides the conversation: the owner's workspace files
// and the live facts of a paper agent under the default limits, with the world's balances.

/** The agent's limits in the live facts: $100 a trade and $500 a rolling day. */
const perTradeUsdMicros = "100000000";
const rollingDayUsdMicros = "500000000";

/** The workspace files and live facts of a scenario's run, for its one agent; it has no skill. */
export function scenarioContextOf(
  world: ScenarioWorld,
  facts: WorldFacts,
  agent: Id<"agt">,
): ContextSource {
  const portfolio = portfolioOf(facts);
  const live = liveFactsViewSchema.parse({
    agent,
    at: facts.now,
    timeZone: "UTC",
    mode: "paper",
    frozen: false,
    approvalMode: "manual",
    sendLevel: 0,
    balances: portfolio["balances"] ?? [],
    totalUsdMicros: portfolio["paperTotalUsdMicros"] ?? "0",
    orders: [],
    spentTodayUsdMicros: "0",
    perTradeUsdMicros,
    rollingDayUsdMicros,
    assets: portfolio["assets"] ?? {},
  });
  const reach = (asked: Id<"agt">, signal: AbortSignal): void => {
    signal.throwIfAborted();
    if (asked !== agent) {
      throw new Error("The evaluation's engine holds one agent.");
    }
  };
  return {
    async workspaceFile(place, signal) {
      reach(place.agent, signal);
      return Promise.resolve(world.workspace?.[place.file]);
    },
    async skills(asked, signal) {
      reach(asked, signal);
      return Promise.resolve([]);
    },
    async liveFacts(asked, signal) {
      reach(asked, signal);
      return Promise.resolve(live);
    },
  };
}
