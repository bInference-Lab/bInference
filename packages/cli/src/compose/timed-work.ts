import type { Engine } from "@binference/engine";

/**
 * The engine's work that waits for its time, which the timers of the engine's service run: a rescue
 * address's ceiling change, the gas check, the auto orders that wait for no price, the cards whose
 * time is up, the schedules whose time came, the copy orders' leader trades, the alerts webhook
 * rules accepted (decision 0338), the token launches
 * waiting for their launchpad's pin, the re-check of the orders after a stop or a sleep, the
 * daily summaries (decision 0273), the bridges in transit (decision 0320), the unstaked coin
 * ready to claim (decision 0327), and the prune of the alerts and inbox entries outside input
 * grows (decision 0333).
 */
export type TimedWork = Pick<
  Engine,
  | "settle"
  | "checkGas"
  | "tickOrders"
  | "expireCards"
  | "runSchedules"
  | "runCopies"
  | "fillWebhookAlerts"
  | "checkPins"
  | "downtime"
  | "sendDailySummaries"
  | "followBridges"
  | "tellClaimsReady"
  | "pruneRecords"
  | "followBreaker"
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
    fillWebhookAlerts: engine.fillWebhookAlerts,
    checkPins: engine.checkPins,
    downtime: engine.downtime,
    sendDailySummaries: engine.sendDailySummaries,
    followBridges: engine.followBridges,
    tellClaimsReady: engine.tellClaimsReady,
    pruneRecords: engine.pruneRecords,
    followBreaker: engine.followBreaker,
  };
}
