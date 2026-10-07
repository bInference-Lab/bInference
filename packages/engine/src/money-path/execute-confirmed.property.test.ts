import type { Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { type IntentKind, intentKinds } from "../intents/intent-kind.js";
import { type IntentState, intentStates } from "../intents/intent-state.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { PaperFills } from "../paper/paper-fills.js";
import type { Executor } from "../ports.js";
import { createExecuteConfirmed } from "./execute-confirmed.js";

const machine = createIntentStateMachine({ clock: createManualClock(1_000) });
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const live = { signal: new AbortController().signal };

type Route = "paper" | "executor";

interface Case {
  readonly kind: IntentKind;
  readonly isAgentOnPaper: boolean;
  readonly state: IntentState;
}

const cases: fc.Arbitrary<Case> = fc.record({
  kind: fc.constantFrom(...intentKinds),
  isAgentOnPaper: fc.boolean(),
  state: fc.constantFrom(...intentStates),
});

// Whether the state machine stores the owner's proposal on paper, as it does for the agent's mode.
function storedOnPaper({ kind, isAgentOnPaper }: Case): boolean {
  const proposed = machine.propose({
    kind,
    proposer: "owner",
    isPaper: isAgentOnPaper,
    hasOutsideContent: false,
    agentStatus: "active",
  });
  if (!proposed.ok) {
    throw new Error(`The owner's ${kind} must be proposed.`);
  }
  return proposed.value.status.isPaper;
}

// Where the execute step sends each intent it is handed, in order.
async function routesOf(item: Case): Promise<readonly Route[]> {
  const routes: Route[] = [];
  const paper: PaperFills = {
    fillAtQuote: async (snapshot) => {
      routes.push("paper");
      return await Promise.resolve(snapshot);
    },
  };
  const executor: Executor = {
    take: async () => {
      routes.push("executor");
      await Promise.resolve();
    },
  };
  const record = { id: intent, kind: item.kind, state: item.state, isPaper: storedOnPaper(item) };
  await createExecuteConfirmed({ paper, executor })({ record } as IntentSnapshot, live);
  return routes;
}

// Spec 6, invariant 3 and decision 0100: only a confirmed intent moves on, a paper one to the paper
// fill and a live one, a rescue in paper mode too, to the executor.
function expectedRoutes(item: Case): readonly Route[] {
  if (item.state !== "confirmed") {
    return [];
  }
  const isPaper = item.isAgentOnPaper && item.kind !== "rescue";
  return [isPaper ? "paper" : "executor"];
}

describe("the execute step, for every intent the state machine stores", () => {
  it("never hands a paper intent to the executor, nor a rescue to the paper fill", async () => {
    await fc.assert(
      fc.asyncProperty(cases, async (item) => {
        expect(await routesOf(item)).toStrictEqual(expectedRoutes(item));
      }),
    );
  });
});
