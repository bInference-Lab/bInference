import type { ProtocolClient } from "@binference/client";
import { err, type Id, idSchema, ok } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { sha256Hex } from "@binference/engine";
import { createRunningTurns, type RunningTurns } from "@binference/engine/chat";
import { testAgent, testCoin, testToken, testWallet } from "@binference/engine/testing";
import type { IntentView } from "@binference/protocol";
import {
  callsReply,
  createTestTurn,
  type TestTool,
  type TurnEngine,
  type TurnStatusLine,
} from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import { makeRuntimeToken } from "../agent-runtime/runtime-token.js";
import { type Skeleton, skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";

// The chat relay end to end: the owner's message through the composed engine and its protocol
// server to a runtime signed in with the token of its current start, whose turn runs the real turn
// loop on a scripted model, and the proposal it makes back through the server to the money path.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const skeletons: Skeleton[] = [];

afterEach(async () => {
  await Promise.all(skeletons.splice(0).map(async (skeleton) => skeleton.close()));
});

interface Relay {
  readonly skeleton: Skeleton;
  readonly turns: RunningTurns;
  /** The runtime, signed in with the token of its current start. */
  readonly runtime: ProtocolClient;
}

async function startRelay(composition: (typeof skeletonCompositions)[number]): Promise<Relay> {
  const turns = createRunningTurns();
  const skeleton = await startSkeleton(composition.parts(), { turns });
  skeletons.push(skeleton);
  await skeleton.client.call("approval/set", { agent: testAgent, mode: "auto" }, live());
  await skeleton.client.call("portfolio/resetPaper", { agent: testAgent }, live());
  const { access } = skeleton.parts.stores;
  const options = { access, clock: skeleton.clock, random: createSeededRandom(21) };
  const token = await makeRuntimeToken(options, live().signal);
  turns.startRuntime(token.id);
  const runtime = await skeleton.connect(token.token, "runtime");
  return { skeleton, turns, runtime };
}

/** Where a turn runs: its agent's session, and the turn the engine reserved for its message. */
interface TurnPlace {
  readonly session: Id<"ses">;
  readonly turn: Id<"trn">;
}

function statusKeyOf(line: TurnStatusLine): string {
  return line.line === "failed" ? `turn.failed.${line.failure}` : `turn.${line.line}`;
}

// The engine's side of one turn, over the runtime's protocol client.
function engineOver(runtime: ProtocolClient, place: TurnPlace): TurnEngine {
  const at = { agent: testAgent, turn: place.turn };
  return {
    async start(request, signal) {
      const messages = request.messages.map((id) => idSchema("msg").parse(id));
      const args = {
        ...at,
        session: place.session,
        messages,
        outsideContent: request.outsideContent,
      };
      try {
        return ok(await runtime.call("turn/start", args, { signal }));
      } catch {
        return err("unavailable");
      }
    },
    async mark(signal) {
      await runtime.call("turn/mark", at, { signal });
    },
    async say(text, signal) {
      await runtime.call(
        "turn/say",
        { ...at, session: place.session, text, final: true },
        { signal },
      );
    },
    async status(line, signal) {
      await runtime.call("turn/status", { ...at, statusKey: statusKeyOf(line) }, { signal });
    },
    async end(outcome, signal) {
      await runtime.call("turn/end", { ...at, outcome }, { signal });
    },
  };
}

// The propose tool: a swap through the engine, as the runtime fills the agent and its wallet.
function swapTool(runtime: ProtocolClient, proposed: IntentView[]): TestTool {
  return {
    name: "swap",
    kind: "propose",
    run: async ({ signal, idempotencyKey }) => {
      const request = {
        kind: "swap" as const,
        agent: testAgent,
        wallet: testWallet,
        reason: "The owner asked for the token",
        from: testCoin,
        to: testToken,
        amount: { base: 1_000_000n },
      };
      const view = await runtime.call("intent/propose", request, { signal, key: idempotencyKey });
      proposed.push(view);
      return { text: `${view.intent} waits for the owner's confirmation`, isError: false };
    },
  };
}

const searchWeb: TestTool = { name: "search_web", kind: "read", outside: true };

// The owner writes; the runtime takes the message from the inbox and runs its turn to the end.
async function chatTurn(relay: Relay, calls: readonly (readonly string[])[]) {
  const { skeleton, runtime } = relay;
  const posted = await skeleton.client.call(
    "chat/post",
    { agent: testAgent, text: "Buy some of the token" },
    live(),
  );
  const { items } = await runtime.call("inbox/list", { agent: testAgent }, live());
  const messages = items.map((view) => view.message);
  await runtime.call("inbox/take", { messages }, live());
  const proposed: IntentView[] = [];
  const { turn } = createTestTurn({
    turnId: posted.turn,
    engine: engineOver(runtime, posted),
    taken: items.map((view) => ({
      id: view.message,
      text: "Buy some of the token",
      outside: false,
    })),
    replies: calls.map((names) => callsReply(names.map((name) => ({ name })))),
    tools: [searchWeb, swapTool(runtime, proposed)],
  });
  const report = await turn.run();
  return { report, proposed, messages };
}

describe.each(skeletonCompositions)("the chat relay on the $name composition", (composition) => {
  it("refuses in auto mode a proposal from a turn that read outside content", slow, async () => {
    const relay = await startRelay(composition);
    const { report, proposed, messages } = await chatTurn(relay, [["search_web"], ["swap"]]);
    expect(messages).toHaveLength(1);
    expect(report).toMatchObject({ state: "ended", outcome: "ok", committed: true });
    expect(proposed).toMatchObject([{ outsideContent: true, state: "awaiting_confirmation" }]);
    expect(relay.turns.runningOf(testAgent)).toBeUndefined();
  });

  it("fills in auto mode the same proposal from a turn that read none", slow, async () => {
    const relay = await startRelay(composition);
    const { report, proposed } = await chatTurn(relay, [["swap"]]);
    expect(report).toMatchObject({ state: "ended", committed: true });
    expect(proposed).toMatchObject([{ outsideContent: false, state: "paper_filled" }]);
    const listed = await relay.runtime.call("inbox/list", { agent: testAgent }, live());
    expect(listed.items).toMatchObject([
      { kind: "inbox/intentSettled", intent: { intent: proposed[0]?.intent } },
    ]);
  });

  it(
    "refuses turn/start and turn/mark from another client with the agent scope",
    slow,
    async () => {
      const relay = await startRelay(composition);
      const { skeleton } = relay;
      const secret = `bnt_${"3".repeat(43)}`;
      await skeleton.parts.stores.access.addToken(
        {
          id: idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000033"),
          label: "another agent client",
          kind: "custom",
          scopes: ["read", "propose", "agent"],
          secretHash: sha256Hex(secret),
          createdAtMs: 0,
        },
        live(),
      );
      const other = await skeleton.connect(secret, "runtime");
      const posted = await skeleton.client.call(
        "chat/post",
        { agent: testAgent, text: "hi" },
        live(),
      );
      const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000001");
      const start = { agent: testAgent, ...posted, messages: [message], outsideContent: false };
      await expect(other.call("turn/start", start, live())).rejects.toMatchObject({
        code: "auth.scope",
      });
      await expect(
        other.call("turn/mark", { agent: testAgent, turn: posted.turn }, live()),
      ).rejects.toMatchObject({ code: "auth.scope" });
      expect(relay.turns.runningOf(testAgent)).toBeUndefined();
    },
  );
});
