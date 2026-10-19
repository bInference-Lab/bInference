import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BinferenceError } from "@binference/core";
import { createRunningTurns } from "@binference/engine/chat";
import { testAgent, testCoin, testToken } from "@binference/engine/testing";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { callsReply, textReply } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import { cliTokenFile } from "../compose/cli-token.js";
import { engineEndpoint, platformOf } from "../compose/engine-locations.js";
import {
  type Skeleton,
  skeletonCompositions,
  skeletonSecrets,
  startSkeleton,
} from "../compose/test-skeleton.js";
import { superviseRuntime, watchChat } from "./runtime-machine.js";
import { type PtyChat, startPtyChat } from "./terminal-chat-pty.js";
import { createTestMachines, hostOn, noPermissions, type TestMachine } from "./test-host.js";

// `binference chat` end to end in a pseudo-terminal: the CLI runs as a process of its own on the
// machine's state folder, signs in over the IPC endpoint the skeleton engine serves, and the
// agent runtime answers in this process on a scripted model. The owner writes, answers the
// agent's question with a number key, confirms the card of its swap with Ctrl+Y, reads the
// agent's report and leaves with Ctrl+C.

const main = fileURLToPath(new URL("../main.ts", import.meta.url));
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 90_000 };
const machines = createTestMachines();
const stops: (() => Promise<void>)[] = [];
const report = "Bought 2 TKN on paper.";
const question = { text: "How long do you hold a token?", choices: ["Minutes", "Hours"] };
const reason = "You hold for hours, so a small buy.";

afterEach(async () => {
  for (const stop of stops.splice(0)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the chat ends before the engine stops
    await stop();
  }
  await machines.removeAll();
});

// The model asks a question, proposes a swap once answered, and reports the paper fill.
const replies = [
  callsReply([{ name: "ask_owner", args: question }], "One question first."),
  callsReply([
    { name: "swap", args: { from: testCoin, to: testToken, amount: { base: "1000000" }, reason } },
  ]),
  textReply(report),
];

// The skeleton engine on the machine's own IPC endpoint, with the CLI's token in its file, and
// the agent runtime the engine starts, on paper in manual mode.
async function serveChat(machine: TestMachine): Promise<Skeleton> {
  const [composition] = skeletonCompositions;
  if (composition === undefined) {
    throw new BinferenceError({ code: "test.no_skeleton", message: "No skeleton composition." });
  }
  const turns = createRunningTurns();
  const skeleton = await startSkeleton(composition.parts(), { turns });
  const platform = platformOf(hostOn(machine, []));
  const files = { permissions: noPermissions, signal: live().signal };
  const tokenFile = cliTokenFile(platform.stateFolder);
  await ensurePrivateFolder(dirname(tokenFile), files);
  await writePrivateFile(tokenFile, `${skeletonSecrets.cli}\n`, files);
  const bound = await engineEndpoint(platform).bind({
    signal: new AbortController().signal,
    onSocket: (socket) => skeleton.composed.server.acceptIpc(socket),
  });
  if (!bound.ok) {
    throw new BinferenceError({ code: "test.ipc_in_use", message: "The IPC endpoint is taken." });
  }
  await skeleton.client.call("approval/set", { agent: testAgent, mode: "manual" }, live());
  await skeleton.client.call("portfolio/resetPaper", { agent: testAgent }, live());
  const engine = { ...skeleton, stores: skeleton.parts.stores, server: skeleton.composed.server };
  const supervisor = superviseRuntime(engine, { turns, script: { replies } });
  stops.push(async () => {
    await supervisor.stop(AbortSignal.timeout(10_000));
    await bound.value.close();
    await skeleton.close();
  });
  return skeleton;
}

function chatOn(machine: TestMachine): PtyChat {
  const chat = startPtyChat({
    main,
    args: ["chat"],
    parentEnv: process.env,
    env: { BINFERENCE_HOME: machine.folder, LANG: "en_US.UTF-8" },
    cwd: dirname(main),
  });
  stops.unshift(async () => {
    chat.kill();
    await chat.exited;
  });
  return chat;
}

describe("binference chat in a pseudo-terminal", () => {
  it("answers the agent's question by key, confirms its card by key and leaves", slow, async () => {
    const machine = await machines.create(0);
    const skeleton = await serveChat(machine);
    const pushes = watchChat(skeleton.client, testAgent);
    const chat = chatOn(machine);
    await chat.shows("Chat with main.");
    await skeleton.clock.advance(1_000);
    chat.type("hi\r");
    await chat.shows("2. Hours");
    await chat.shows("Press 1 to 2 to answer");
    await skeleton.clock.advance(1_000);
    chat.type("2");
    await chat.shows("Answered: Hours");
    await chat.shows("Ctrl+Y Confirm · Ctrl+N Cancel");
    chat.type("\u0019");
    await chat.shows("Confirmed. It fills on paper.");
    await chat.shows(`main: ${report}`);
    chat.type("\u0003");
    await expect(chat.exited).resolves.toBe(0);
    expect(chat.screen()).toContain("Chat closed.");
    await pushes.turnsEnded(3);
    const filled = await skeleton.client.call("intent/list", { limit: 10 }, live());
    expect(filled.items.map((intent) => intent.state)).toStrictEqual(["paper_filled"]);
    expect(pushes.pushes.filter(({ kind }) => kind === "chat/questionClosed")).toMatchObject([
      { data: { state: "answered", answer: { choice: 1, surface: "cli" } } },
    ]);
  });
});
