import { testAgent } from "@binference/engine/testing";
import { type QuestionView, questionViewSchema } from "@binference/protocol";
import { callsReply, createSharedScript, textReply } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type FirstChat, ownerTexts, pushed, say, startFirstChat } from "./first-chat-machine.js";

// The agent's question end to end: the runtime's ask_owner asks through turn/ask, the turn ends
// after its batch, and the owner's answer, pressed or written, starts the next turn once, also
// when the runtime restarts between the question and the answer. A question left 24 hours closes.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const machines: FirstChat[] = [];
const dayMs = 86_400_000;

afterEach(async () => {
  await Promise.all(machines.splice(0).map(async (machine) => machine.stop()));
});

const question = {
  text: "How long do you like to hold a token?",
  choices: ["Minutes", "Hours", "Days", "Weeks"],
};

// The model asks on the owner's first message, then answers each message after it.
function askingScript() {
  return createSharedScript([
    callsReply([{ id: "ask", name: "ask_owner", args: question }], "One question first."),
    textReply("Hours it is."),
    textReply("Noted."),
  ]);
}

async function asked(machine: FirstChat): Promise<QuestionView> {
  await say(machine, "hi", 1);
  await machine.chat.pushed("chat/question", 1);
  const push = machine.chat.pushes.find(({ kind }) => kind === "chat/question");
  return questionViewSchema.parse(push?.data);
}

async function started(script: ReturnType<typeof askingScript>): Promise<FirstChat> {
  const machine = await startFirstChat("en", script);
  machines.push(machine);
  return machine;
}

describe("the agent's question", () => {
  it("ends the asking turn after its batch, with no other model call", slow, async () => {
    const script = askingScript();
    const machine = await started(script);
    const view = await asked(machine);
    expect(view).toMatchObject({ agent: testAgent, ...question, state: "open" });
    expect(view.closesAt - view.createdAt).toBe(dayMs);
    expect(script.requests).toHaveLength(1);
    expect(pushed(machine.chat, "chat/turnEnded", "turn")).toHaveLength(1);
  });

  it(
    "starts one turn with the pressed choice after a restart between question and answer",
    slow,
    async () => {
      const script = askingScript();
      const machine = await started(script);
      const view = await asked(machine);
      const answer = { agent: testAgent, question: view.question, choice: 1 };
      await machine.restart(async () => {
        await machine.skeleton.client.call("chat/answer", answer, live());
      });
      await machine.chat.turnsEnded(2);
      expect(ownerTexts(script.requests[1])).toStrictEqual(["hi", "Hours"]);
      expect(pushed(machine.chat, "chat/questionClosed", "state")).toStrictEqual(["answered"]);
      await machine.restart();
      await say(machine, "thanks", 3);
      expect(script.requests).toHaveLength(3);
      expect(ownerTexts(script.requests[2])).toStrictEqual(["hi", "Hours", "thanks"]);
    },
  );

  it("takes the owner's written message as the answer, in one turn", slow, async () => {
    const script = askingScript();
    const machine = await started(script);
    await asked(machine);
    await say(machine, "Days, mostly", 2);
    expect(ownerTexts(script.requests[1])).toStrictEqual(["hi", "Days, mostly"]);
    expect(machine.chat.pushes.filter(({ kind }) => kind === "chat/questionClosed")).toMatchObject([
      { data: { state: "answered", answer: { typed: "Days, mostly" } } },
    ]);
  });

  it("closes a question left 24 hours, and a press after it starts no turn", slow, async () => {
    const script = askingScript();
    const machine = await started(script);
    const view = await asked(machine);
    await machine.skeleton.clock.advance(dayMs);
    const answer = { agent: testAgent, question: view.question, choice: 0 };
    await expect(machine.skeleton.client.call("chat/answer", answer, live())).rejects.toMatchObject(
      {
        code: "question.closed",
      },
    );
    expect(machine.chat.pushes.filter(({ kind }) => kind === "chat/questionClosed")).toMatchObject([
      { data: { state: "closed", closeReason: "expired" } },
    ]);
    expect(script.requests).toHaveLength(1);
  });
});
