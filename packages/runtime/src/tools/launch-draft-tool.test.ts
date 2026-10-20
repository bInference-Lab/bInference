import { BinferenceError, idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, coin, context, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient, type FakeAnswer } from "../testing/fake-tool-client.js";
import { agentToolBox } from "./agent-tools.js";
import { draftedText } from "./launch-draft-tool.js";

const message = idSchema("msg").parse("msg_0190f1c2-3a4b-7c5d-8e6f-000000000285");
const photos = [
  { message, image: "tg:AgACAgIAAxkBAAIBcat" },
  { message, image: "tg:AgACAgIAAxkBAAIBdog" },
];
const turn = { ...toolTurn, photos };
const launch = {
  reason: "You asked for a cat token",
  venue: "fake-curve",
  name: "Moon Cat",
  symbol: "MCAT",
  pairWith: coin,
};
const drafted: FakeAnswer = { draft: "c2hvd24tb25jZS1h", expiresAt: 600_001 };

// Runs one launch_draft call over a fake engine answering `answer` to `launch/draft`.
async function draftWith(args: object, answer: FakeAnswer = drafted) {
  const client = createFakeToolClient({ "launch/draft": answer });
  const call = { id: "c1", name: "launch_draft", argumentsText: JSON.stringify(args) };
  const prepared = agentToolBox({ agent, client, turn }).prepare(call);
  if (!prepared.ready) {
    throw new Error(`The call was refused: ${prepared.text}`);
  }
  return { outcome: await prepared.run(context), calls: client.calls() };
}

describe("launch_draft", () => {
  it("drafts with the turn's nth photo, in the turn it serves", async () => {
    const { outcome, calls } = await draftWith({ launch, photo: 2 });
    expect(outcome).toStrictEqual({ text: draftedText, isError: false });
    expect(calls).toStrictEqual([
      {
        op: "launch/draft",
        args: { agent, session: turn.session, turn: turn.turn, launch, photo: photos[1] },
        key: context.idempotencyKey,
      },
    ]);
  });

  it("refuses a photo the turn does not hold before the engine", async () => {
    const { outcome, calls } = await draftWith({ launch, photo: 3 });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(
      /^not drafted, and nothing reached the owner: the picture must be/u,
    );
    expect(calls).toStrictEqual([]);
  });

  it("reads the engine's refusal as the next step", async () => {
    const refusal = new BinferenceError({ code: "intent.launch_wallet_missing", message: "No." });
    const { outcome } = await draftWith({ launch, photo: 1 }, refusal);
    expect(outcome).toStrictEqual({
      text: "not drafted, and nothing reached the owner: this agent has no launch wallet. Tell the owner to make one with `binference wallet create --launch` and fund it from outside.",
      isError: true,
    });
  });
});
