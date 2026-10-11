import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the control listener on loopback through which the browser test drives the engine
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import process from "node:process";
import type { JsonValue } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import {
  testAgent as agent,
  testCoin as coin,
  testToken as token,
  testWallet as wallet,
} from "@binference/engine/testing";
import { protocolIdSchema } from "@binference/protocol";
import { openConsoleFiles } from "../compose/console-files.js";
import { type Skeleton, skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";
import { smokeEnvSchema } from "./smoke-engine.schema.js";

// The console's smoke engine (`pnpm test:console`): the skeleton's engine on in-memory stores and
// the fake chain, serving the built console on loopback, with a control listener beside it that
// makes pairing links and paper swaps for the browser test. Like `src/main.ts`, it alone reads
// `process`. Nothing here reaches the network.
const env = smokeEnvSchema.parse(process.env);
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const [selfHosted] = skeletonCompositions;

async function startEngine(): Promise<Skeleton> {
  const logger = createMemoryLogger({ subsystem: "smoke" });
  const consoleFiles = await openConsoleFiles(env.SMOKE_CONSOLE, { logger, ...live() });
  if (selfHosted === undefined || consoleFiles === undefined) {
    throw new Error("The smoke engine needs the console's build: run pnpm test:console.");
  }
  const http = { host: "127.0.0.1", port: Number(env.SMOKE_PORT) };
  const skeleton = await startSkeleton(selfHosted.parts(), { browser: { http, consoleFiles } });
  await skeleton.composed.server.start(live().signal);
  await skeleton.client.call("portfolio/resetPaper", { agent }, live());
  return skeleton;
}

// Each control route: a pairing link, a paper swap that opens a card, and an intent's state.
async function answerOf(skeleton: Skeleton, request: IncomingMessage): Promise<JsonValue> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const { client } = skeleton;
  if (url.pathname === "/pair") {
    return { link: (await client.call("device/pair", {}, live())).link };
  }
  if (url.pathname === "/propose") {
    const swap = { kind: "swap", agent, wallet, reason: "Smoke", from: coin, to: token } as const;
    const proposed = await client.call(
      "intent/propose",
      { ...swap, amount: { base: 1_000_000n } },
      live(),
    );
    return { intent: proposed.intent };
  }
  const intent = protocolIdSchema("intent").parse(url.searchParams.get("intent"));
  return { state: (await client.call("intent/get", { intent }, live())).state };
}

function serveControl(skeleton: Skeleton) {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/ready") {
      response.writeHead(200).end();
      return;
    }
    answerOf(skeleton, request).then(
      (answer) =>
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer)),
      () => response.writeHead(500).end(),
    );
  });
}

const skeleton = await startEngine();
const control = serveControl(skeleton);
control.listen(Number(env.SMOKE_CONTROL_PORT), "127.0.0.1");
await once(control, "listening");
process.stdout.write(`smoke engine on http://127.0.0.1:${env.SMOKE_PORT}\n`);
const stopping = await Promise.race([once(process, "SIGTERM"), once(process, "SIGINT")]);
control.close();
await skeleton.close();
process.stdout.write(`smoke engine stopped on ${String(stopping[0])}\n`);
