// oxlint-disable-next-line eslint/no-restricted-imports -- the image smoke test's model listens on the engine container's loopback; nothing ships a listener
import { createServer } from "node:http";
import process from "node:process";
import type { Http } from "@binference/core";
import { answerFromFakes } from "../e2e/fake-service-answer.js";
import { answerImageModel } from "./image-model.js";
import { modelPort } from "./image-names.js";

// The image smoke test's scripted model on the loopback of the engine's container, whose network
// it shares. The agent runtime gets none of the engine's variables, so it trusts no certificate of
// the test's: it calls the model over plain HTTP on its own machine, as config allows a model
// provider there. It runs in the image's build stage, which holds the sources and tsx, and prints
// one line once it listens.
const services = new Map<string, Http>([["127.0.0.1", { request: answerImageModel }]]);
createServer(answerFromFakes(services)).listen(modelPort, "127.0.0.1", () => {
  process.stdout.write(`${JSON.stringify({ model: "listening", port: modelPort })}\n`);
});
