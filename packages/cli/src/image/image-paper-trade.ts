import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { createProtocolClient } from "@binference/client";
import { BinferenceError, type Logger } from "@binference/core";
import { readTextFile } from "@binference/platform";
import { type IntentView, operations } from "@binference/protocol";
import { WebSocket } from "ws";

// The image smoke test's paper trade, run inside the container under test by the image's own Node
// and packages: the test mounts this file beside the installed binference, whose node_modules
// resolve its imports, and Node strips its types. It signs in over the engine's IPC socket with
// the CLI's token, as `binference` does, starts the paper portfolio from its starting balances, proposes a swap of 0.001 BNB for USDT, taps Confirm on
// its card and prints the intent's end as one JSON line. The engine quotes on BNB Smart Chain's
// public RPCs and KyberSwap's API.
const folder = join(homedir(), ".binference");
const spend = 10n ** 15n;
const ends = new Set(["paper_filled", "failed_check", "rejected_policy", "expired", "cancelled"]);
const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

// ws reaches a Unix socket through its `ws+unix:` address: the socket's path, then the request path.
function socketOf(address: string): WebSocket {
  const socket = new WebSocket(`ws+unix://${address}:/ws`, { perMessageDeflate: false });
  socket.on("error", () => undefined);
  return socket;
}

async function cliToken(): Promise<string> {
  const read = await readTextFile(join(folder, "auth", "cli.token"), AbortSignal.timeout(5_000));
  if (!read.ok) {
    throw new BinferenceError({ code: "image.no_token", message: "The CLI token is missing." });
  }
  return read.value.trim();
}

const client = createProtocolClient({
  operations,
  openSocket: () => socketOf(join(folder, "run", "engine.sock")),
  client: { kind: "cli", version: "image-smoke" },
  credential: { token: await cliToken() },
  clock: { now: () => Date.now(), sleep: async (ms, signal) => wait(ms, undefined, { signal }) },
  random: { bytes: (length) => randomBytes(length) },
  logger: silent,
});

async function settled(intent: IntentView["intent"], until: number): Promise<IntentView> {
  const view = await client.call("intent/get", { intent }, { signal: AbortSignal.timeout(10_000) });
  if (ends.has(view.state) || Date.now() > until) {
    return view;
  }
  await wait(1_000);
  return settled(intent, until);
}

const call = { signal: AbortSignal.timeout(120_000) };
try {
  await client.connect(call.signal);
  const [agent] = (await client.call("engine/status", {}, call)).agents;
  const usdt = bsc.tokens.find((token) => token.symbol === "USDT");
  if (agent === undefined || usdt === undefined) {
    throw new BinferenceError({ code: "image.no_agent", message: "No agent or no USDT." });
  }
  // A new agent's paper portfolio is empty until a reset gives it the starting balances.
  await client.call("portfolio/resetPaper", { agent: agent.id }, call);
  const chain = chainRefSchema.parse(bsc.id);
  const { assetNamespace, assetReference } = bsc.nativeAsset;
  const proposed = await client.call(
    "intent/propose",
    {
      kind: "swap",
      agent: agent.id,
      reason: "Image smoke test: buy USDT on paper",
      from: assetRefSchema.parse(`${chain}/${assetNamespace}:${assetReference}`),
      to: assetRefSchema.parse(`${chain}/erc20:${usdt.address}`),
      amount: { base: spend },
    },
    call,
  );
  const { card } = proposed;
  if (card === undefined) {
    const reason = proposed.outcome?.reason ?? proposed.state;
    throw new BinferenceError({ code: "image.no_card", message: `No card: ${reason}.` });
  }
  const tap = { intent: proposed.intent, card: card.card, cardVersion: card.version };
  const confirmed = await client.call("intent/confirm", tap, call);
  const end = await settled(confirmed.intent, Date.now() + 60_000);
  process.stdout.write(`${JSON.stringify({ mode: agent.mode, state: end.state })}\n`);
} finally {
  client.close();
}
