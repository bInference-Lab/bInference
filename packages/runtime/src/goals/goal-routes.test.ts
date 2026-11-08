import type { Id } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { createMemoryGoalStore } from "@binference/store/testing";
import { describe, expect, it } from "vitest";
import type { RouteLine } from "../control/control-line.schema.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { createMemoryAgentStores, nthTestId } from "../testing/memory-agent-stores.js";
import { createGoalDesk } from "./goal-desk.js";
import { answerGoalRoute } from "./goal-routes.js";

const agent = nthTestId("agt", 1);
const session = nthTestId("ses", 1);
const live = (): AbortSignal => new AbortController().signal;

async function setUp() {
  const { stores, database } = await createMemoryAgentStores();
  const clock = createManualClock(10_000);
  const client = createFakeToolClient({ "goal/show": {} });
  const desk = createGoalDesk({
    goals: createMemoryGoalStore(database),
    fence: stores.fence,
    client,
    clock,
  });
  const followed: { readonly agent: Id<"agt">; readonly session: Id<"ses"> }[] = [];
  const parts = {
    desk,
    sessions: stores.sessions,
    fence: stores.fence,
    clock,
    follow: (chat: (typeof followed)[number]) => followed.push(chat),
  };
  return { parts, followed };
}

let routeNumber = 0;

function route(
  op: "goal/get" | "goal/set" | "goal/change",
  args: Readonly<Record<string, string>>,
  origin: RouteLine["origin"] = "owner",
): RouteLine & { readonly op: typeof op } {
  routeNumber += 1;
  return {
    t: "route",
    id: `r${String(routeNumber)}`,
    op,
    args: { agent, session, ...args },
    origin,
  };
}

describe("the routed goal operations", () => {
  it("sets the owner's goal in a chat it opens, then pauses, resumes and clears it", async () => {
    const { parts, followed } = await setUp();
    const set = await answerGoalRoute(
      route("goal/set", { objective: "Find three tokens" }),
      parts,
      live(),
    );
    expect(set).toMatchObject({
      result: { goal: { status: "active", objective: "Find three tokens", spentUsdMicros: "0" } },
    });
    const paused = await answerGoalRoute(route("goal/change", { action: "pause" }), parts, live());
    expect(paused).toMatchObject({ result: { goal: { status: "paused", pauseReason: "owner" } } });
    const resumed = await answerGoalRoute(
      route("goal/change", { action: "resume" }),
      parts,
      live(),
    );
    expect(resumed).toMatchObject({ result: { goal: { status: "active" } } });
    const cleared = await answerGoalRoute(route("goal/change", { action: "clear" }), parts, live());
    expect(cleared).toMatchObject({ result: {} });
    expect(await answerGoalRoute(route("goal/get", {}), parts, live())).toMatchObject({
      result: {},
    });
    expect(followed).toHaveLength(4);
  });

  it("refuses a second goal, a change of none, and every change but the owner's", async () => {
    const { parts } = await setUp();
    const objective = { objective: "Find three tokens" };
    expect(
      await answerGoalRoute(route("goal/change", { action: "pause" }), parts, live()),
    ).toMatchObject({
      error: { code: "goal.none" },
    });
    await answerGoalRoute(route("goal/set", objective), parts, live());
    expect(await answerGoalRoute(route("goal/set", objective), parts, live())).toMatchObject({
      error: { code: "goal.exists" },
    });
    for (const origin of ["agent", "untrusted"] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one call at a time
      const refused = await answerGoalRoute(
        route("goal/change", { action: "clear" }, origin),
        parts,
        live(),
      );
      expect(refused).toMatchObject({ error: { code: "auth.scope" } });
    }
    const read = await answerGoalRoute(route("goal/get", {}, "untrusted"), parts, live());
    expect(read).toMatchObject({ result: { goal: { status: "active" } } });
  });
});
