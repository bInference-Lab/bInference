import type { PriceSource } from "@binference/chain";
import { describe, expect, it } from "vitest";
import type { IntentStore } from "../ports.js";
import {
  activeOrder,
  eightyCents,
  fillIntentsOf,
  fillRowsOf,
  startFillEngine,
} from "./test-fills.js";
import { createdOrder, storedOrder, tapCard, testStopLoss } from "./test-orders.js";

const live = { signal: new AbortController().signal };

/** A fault armed once its order is active, which tells when the run reached it. */
interface Fault {
  readonly isArmed: () => boolean;
  readonly arm: () => void;
  readonly disarm: () => void;
  readonly reached: Promise<void>;
  readonly reach: () => void;
}

function faultOf(): Fault {
  const state = { isArmed: false };
  const told: { reach?: () => void } = {};
  const reached = new Promise<void>((resolve) => {
    told.reach = resolve;
  });
  return {
    isArmed: () => state.isArmed,
    arm: () => {
      state.isArmed = true;
    },
    disarm: () => {
      state.isArmed = false;
    },
    reached,
    reach: () => told.reach?.(),
  };
}

// An intent store whose write of a quote never answers once armed, as a stuck store task.
function hangingAtQuote(store: IntentStore, fault: Fault): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      if (fault.isArmed() && change.state === "quoted") {
        fault.reach();
        return new Promise(() => undefined);
      }
      return store.transition(change, call);
    },
  };
}

// A price source whose reads never answer while armed.
function hangingWhileArmed(source: PriceSource, fault: Fault): PriceSource {
  return {
    ...source,
    usdPrice: async (asset, call) => {
      if (fault.isArmed()) {
        fault.reach();
        return new Promise(() => undefined);
      }
      return source.usdPrice(asset, call);
    },
  };
}

// An intent store that arms the fault as a fill moves to `simulated`, once `isOn` says so.
function armingAtSimulation(store: IntentStore, fault: Fault, isOn: () => boolean): IntentStore {
  return {
    ...store,
    transition: async (change, call) => {
      const moved = await store.transition(change, call);
      if (isOn() && change.state === "simulated") {
        fault.arm();
      } else {
        fault.disarm();
      }
      return moved;
    },
  };
}

describe("an auto order's fill that hangs", () => {
  it("is a skip, fill_failed, after 30 seconds, and its intent is cancelled", async () => {
    const fault = faultOf();
    const test = await startFillEngine({ intents: (store) => hangingAtQuote(store, fault) });
    const order = await activeOrder(test, testStopLoss());
    fault.arm();

    const run = test.engine.fillOrder({ order: order.id, price: eightyCents }, live);
    await fault.reached;
    fault.disarm();
    await test.clock.advance(30_000);

    expect(await run).toBe("skipped");
    expect(await fillIntentsOf(test)).toMatchObject([{ state: "cancelled" }]);
    expect(await fillRowsOf(test, order.id)).toMatchObject([{ reason: "fill_failed" }]);
    expect((await storedOrder(test, order.id)).state).toBe("active");
  });

  it("reads the other side's price before the agent's line, so a tap goes on meanwhile", async () => {
    const fault = faultOf();
    const switched = faultOf();
    const test = await startFillEngine({
      intents: (store) => armingAtSimulation(store, fault, switched.isArmed),
      priceSource: (source) => hangingWhileArmed(source, fault),
    });
    const order = await activeOrder(test, testStopLoss());
    const waiting = await createdOrder(test, testStopLoss());
    switched.arm();

    const run = test.engine.fillOrder({ order: order.id, price: eightyCents }, live);
    await fault.reached;
    // The tap waits on the agent's line: it would never end while the fill's read held it.
    fault.disarm();
    switched.disarm();
    await tapCard(test, waiting.intent, "confirm");
    const tapped = await storedOrder(test, waiting.order);
    await test.clock.advance(30_000);
    await run;

    expect(tapped.state).toBe("active");
  });
});
