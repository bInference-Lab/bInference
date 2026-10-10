import { parentPort, workerData } from "node:worker_threads";
import { Api } from "grammy";
import { pollSetupOf } from "./poll-messages.schema.js";
import { createRelayedFetch } from "./relayed-fetch.js";
import { serveFetches } from "./serve-fetches.js";
import { createApiFetcher, fetchTimeoutMs } from "./update-fetcher.js";

// The poll worker's entry: grammY's Api in this thread, answering the parent's fetches, with every
// request sent through the parent's outbound HTTP.
const setup = pollSetupOf(workerData);
if (parentPort !== null) {
  const api = new Api(setup.token, {
    ...(setup.apiRoot === undefined ? {} : { apiRoot: setup.apiRoot }),
    timeoutSeconds: fetchTimeoutMs / 1000,
    fetch: createRelayedFetch(parentPort),
  });
  serveFetches(parentPort, createApiFetcher(api));
}
