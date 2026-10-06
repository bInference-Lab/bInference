import { parentPort, workerData } from "node:worker_threads";
import { Api } from "grammy";
import { pollSetupOf } from "./poll-messages.schema.js";
import { serveFetches } from "./serve-fetches.js";
import { createApiFetcher, fetchTimeoutMs } from "./update-fetcher.js";

// The poll worker's entry: grammY's Api in this thread, answering the parent's fetches.
const setup = pollSetupOf(workerData);
const api = new Api(setup.token, {
  ...(setup.apiRoot === undefined ? {} : { apiRoot: setup.apiRoot }),
  timeoutSeconds: fetchTimeoutMs / 1000,
});
if (parentPort !== null) {
  serveFetches(parentPort, createApiFetcher(api));
}
