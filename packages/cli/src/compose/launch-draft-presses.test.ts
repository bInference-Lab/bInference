import { createLaunchDraftPresses } from "@binference/engine/surfaces";
import {
  draftOf,
  draftOwnerId,
  refOf,
  testAgent,
  testDraftEngine,
} from "@binference/engine/testing";
import { launchDraftAnswersContract } from "@binference/telegram/testing";
import { describe, expect, it } from "vitest";

const signal = (): AbortSignal => AbortSignal.timeout(5_000);

// The engine's presses of a launch draft, as the bot's composition makes them, on a live engine
// with one draft of the agent open.
async function drafted() {
  const drafting = await testDraftEngine();
  const answer = await draftOf(drafting.test);
  if (!answer.ok) {
    throw new Error(`Expected a draft, got ${answer.error}.`);
  }
  const answers = createLaunchDraftPresses({ desk: drafting.test.engine.launchDrafts });
  const started = async () => {
    const listed = await drafting.test.engine.handlers["intent/list"]({
      args: { agent: testAgent },
      caller: { credential: "tg:7012345678", client: { kind: "telegram" }, scopes: ["read"] },
      signal: signal(),
    });
    return listed.ok ? listed.value.items.length : -1;
  };
  const settled = async () => drafting.test.engine.launchDrafts.idle();
  return {
    answers,
    ref: refOf(drafting.test, answer.value.draft),
    ownerId: draftOwnerId,
    started,
    settled,
  };
}

describe("the engine's presses of a launch draft", () => {
  it.each(launchDraftAnswersContract({ create: drafted }))(
    "follow the Telegram port's contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
