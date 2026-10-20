import type { Engine } from "@binference/engine";

/**
 * The engine's work that waits for its time, which the timers of the engine's service run: a rescue
 * address's ceiling change, the gas check, the auto orders that wait for no price, the cards whose
 * time is up, the schedules whose time came, the copy orders' leader trades, the token launches
 * waiting for their launchpad's pin, and the re-check of the orders after a stop or a sleep.
 */
export type TimedWork = Pick<
  Engine,
  | "settle"
  | "checkGas"
  | "tickOrders"
  | "expireCards"
  | "runSchedules"
  | "runCopies"
  | "checkPins"
  | "downtime"
>;

/** The engine's {@link TimedWork}, for the timers to run. */
export function timedWorkOf(engine: Engine): TimedWork {
  return {
    settle: engine.settle,
    checkGas: engine.checkGas,
    tickOrders: engine.tickOrders,
    expireCards: engine.expireCards,
    runSchedules: engine.runSchedules,
    runCopies: engine.runCopies,
    checkPins: engine.checkPins,
    downtime: engine.downtime,
  };
}
