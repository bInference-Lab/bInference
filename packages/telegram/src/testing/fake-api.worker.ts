import { parentPort, workerData } from "node:worker_threads";
import { Api } from "grammy";
import { pollSetupOf } from "../polling/poll-messages.schema.js";
import { serveFetches } from "../polling/serve-fetches.js";
import { createApiFetcher } from "../polling/update-fetcher.js";
import { createFakeBotApi } from "./fake-bot-api.js";
import { ownerId, textUpdate } from "./update-fixtures.js";

// A poll worker over an in-memory Bot API holding updates 1 and 2, for tests of the thread.
const setup = pollSetupOf(workerData);
const botApi = createFakeBotApi();
botApi.push(
  textUpdate({ updateId: 1, from: ownerId, text: "one" }),
  textUpdate({ updateId: 2, from: ownerId, text: "two" }),
);
if (parentPort !== null) {
  serveFetches(parentPort, createApiFetcher(new Api(setup.token, { fetch: botApi.fetch })));
}
