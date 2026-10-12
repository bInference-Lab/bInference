import { describe, expect, it } from "vitest";
import { testCall, type TestEngine } from "../operations/test-engine.js";
import type { AgentStore, IntentStore } from "../ports.js";
import { activeOrder, eightyCents, fillRowsOf, startFillEngine } from "./test-fills.js";
import { testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

/** A switch a test turns on once its order is active. */
interface Switch {
  readonly isOn: () => boolean;
  readonly turnOn: () => void;
}

function switchOf(): Switch {
  const state = { isOn: false };
  return {
    isOn: () => state.isOn,
    turnOn: () => {
      state.isOn = true;
    },
  };
}

// An agent store that reads the agent archived once the switch is on, as if the owner archived it
// while its order waited for a price.
function archivedWhenOn(store: AgentStore, on: Switch): AgentStore {
  return {
    ...store,
    get: async (agent, call) => {
      const settings = await store.get(agent, call);
      return settings === undefined || !on.isOn()
        ? settings
        : { ...settings, agent: { ...settings.agent, archivedAtMs: 1 } };
    },
  };
}

// An intent store that freezes the whole install as a fill's quote is written, once the switch is
// on: the freeze cancels the fill under the quote's write.
function freezingAtQuote(
  store: IntentStore,
  on: Switch,
  holder: { readonly test?: TestEngine },
): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      if (on.isOn() && change.state === "quoted" && holder.test !== undefined) {
        await holder.test.engine.handlers["safety/freeze"](testCall({}));
      }
      return store.transition(change, call);
    },
  };
}

describe("the reason a skipped fill records", () => {
  it("is fill_failed, not no_route, for a proposal the money path refuses for its agent", async () => {
    const on = switchOf();
    const test = await startFillEngine({ agents: (store) => archivedWhenOn(store, on) });
    const order = await activeOrder(test, testStopLoss());
    on.turnOn();

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("skipped");
    expect(await fillRowsOf(test, order.id)).toMatchObject([{ reason: "fill_failed" }]);
  });

  it("is frozen for a fill a whole-install freeze cancelled, told as a skip", async () => {
    const on = switchOf();
    const holder: { test?: TestEngine } = {};
    const test = await startFillEngine({ intents: (store) => freezingAtQuote(store, on, holder) });
    holder.test = test;
    const order = await activeOrder(test, testStopLoss());
    on.turnOn();

    const outcome = await test.engine.fillOrder({ order: order.id, price: eightyCents }, live);

    expect(outcome).toBe("skipped");
    expect(await fillRowsOf(test, order.id)).toMatchObject([{ reason: "frozen" }]);
  });
});
