import { randomBytes } from "node:crypto";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { createProtocolClient } from "@binference/client";
import { BinferenceError, type Logger } from "@binference/core";
import { readTextFile } from "@binference/platform";
import { type IntentView, operations, type ProtocolId } from "@binference/protocol";
import { WebSocket } from "ws";

// The image smoke test's driver, run inside a container of the image under test by the image's own
// Node and packages: the test mounts this file beside the installed binference, whose node_modules
// resolve its imports, and Node strips its types. It signs in over the engine's IPC socket with
// the CLI's token, as `binference` does, does what its one argument names and prints the outcome
// as one JSON line. `paper` starts the paper portfolio from its starting balances, proposes a swap
// of 0.001 BNB for USDT, taps Confirm on its card and prints the intent's end; the engine quotes on
// BNB Smart Chain's public RPCs and KyberSwap's API. `shell` and `ask` drive the agent's shell
// through the edge's scripted model (`image-model.ts`), whose tool calls the owner's messages name.
const folder = process.env["BINFERENCE_HOME"] ?? "";
const workspace = process.env["BINFERENCE_WORKSPACE"] ?? "";
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
const call = { signal: AbortSignal.timeout(280_000) };
type AgentId = ProtocolId<"agent">;

async function settled(intent: IntentView["intent"], until: number): Promise<IntentView> {
  const view = await client.call("intent/get", { intent }, { signal: AbortSignal.timeout(10_000) });
  if (ends.has(view.state) || Date.now() > until) {
    return view;
  }
  await wait(1_000);
  return settled(intent, until);
}

async function paperTrade(agent: AgentId, mode: string): Promise<object> {
  const usdt = bsc.tokens.find((token) => token.symbol === "USDT");
  if (usdt === undefined) {
    throw new BinferenceError({ code: "image.no_usdt", message: "No USDT." });
  }
  // A new agent's paper portfolio is empty until a reset gives it the starting balances.
  await client.call("portfolio/resetPaper", { agent }, call);
  const chain = chainRefSchema.parse(bsc.id);
  const { assetNamespace, assetReference } = bsc.nativeAsset;
  const proposed = await client.call(
    "intent/propose",
    {
      kind: "swap",
      agent,
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
  return { mode, state: end.state };
}

// The text of the first message of the agent's chat that holds `marker`, waiting up to 45 seconds
// for it; the marker comes from what a command printed, never from its line. Without it, the
// chat's last messages, so a failing test shows what the agent did instead.
async function heard(agent: AgentId, marker: string): Promise<string> {
  const until = Date.now() + 45_000;
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the chat is read again until the marker is in it
    const page = await client.call("chat/messages", { agent, limit: 200 }, call);
    const found = page.items.find((item) => item.text?.includes(marker));
    if (found?.text !== undefined) {
      return found.text;
    }
    if (Date.now() > until) {
      const last = page.items
        .slice(-12)
        .map((item) => `${item.role} ${item.kind}: ${item.text ?? ""}`);
      return `No message holds ${marker}. The chat ends:\n${last.join("\n")}`;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one read a second
    await wait(1_000);
  }
}

// The owner's message that makes the scripted model call one tool.
async function askTool(agent: AgentId, tool: string, args: object): Promise<void> {
  await client.call("chat/post", { agent, text: `TOOL ${tool} ${JSON.stringify(args)}` }, call);
}

async function shellTurns(agent: AgentId): Promise<object> {
  const auth = join(folder, "auth", "cli.token");
  const keys = join(folder, "keys");
  const database = join(folder, "engine.sqlite");
  const probe = `id -un; cat ${auth}; ls ${keys}; head -c 16 ${database}; echo made-by-$((6*7)) > shell-made.txt; echo probe-$((1+1))`;
  await askTool(agent, "shell", { command: probe, folder: workspace });
  const probed = await heard(agent, "probe-2");
  await askTool(agent, "file_read", { path: "shell-made.txt" });
  const read = await heard(agent, "made-by-42");
  await askTool(agent, "file_write", { path: "engine-made.txt", content: "engine-wrote\n" });
  const append = "echo shell-$((2+2)) >> engine-made.txt && cat engine-made.txt";
  await askTool(agent, "shell", { command: append, folder: workspace });
  const appended = await heard(agent, "shell-4");
  await askTool(agent, "shell", { command: "sleep 2; echo background-$((5+5))", background: true });
  const background = await heard(agent, "background-10");
  return { probed, read, appended, background };
}

// With `shell.ask` set to `always`, the command waits for the owner, who allows it once.
async function askedTurn(agent: AgentId): Promise<object> {
  await askTool(agent, "shell", { command: "echo approved-$((3*3))" });
  const until = Date.now() + 60_000;
  let requests = await client.call("shell/requests", {}, call);
  while (requests.items.length === 0 && Date.now() < until) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one read a second until the request is open
    await wait(1_000);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one read a second until the request is open
    requests = await client.call("shell/requests", {}, call);
  }
  const [open] = requests.items;
  if (open === undefined) {
    return { asked: false };
  }
  await client.call("shell/answer", { request: open.request, answer: "once" }, call);
  return { asked: true, command: open.command, approved: await heard(agent, "approved-9") };
}

try {
  await client.connect(call.signal);
  const [agent] = (await client.call("engine/status", {}, call)).agents;
  if (agent === undefined) {
    throw new BinferenceError({ code: "image.no_agent", message: "No agent." });
  }
  const steps = new Map([
    ["paper", async () => paperTrade(agent.id, agent.mode)],
    ["shell", async () => shellTurns(agent.id)],
    ["ask", async () => askedTurn(agent.id)],
  ]);
  const step = steps.get(process.argv[2] ?? "paper") ?? steps.get("paper");
  const outcome = await step?.();
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
} finally {
  client.close();
}
