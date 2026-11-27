import { idSchema } from "@binference/core";
import { type InboxMessageView, inboxMessageViewSchema, type Locale } from "@binference/protocol";
import { expect } from "vitest";
import { expectOk, testSwap } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall, testCallers } from "./test-engine.js";

const runtime = testCallers.runtime;

/** The settle messages the test engine pushed to the agent runtime, oldest first. */
export function settlesOf(test: TestEngine): readonly InboxMessageView[] {
  return test.pushes
    .filter((push) => push.topic === "inbox")
    .map((push) => inboxMessageViewSchema.parse(push.data))
    .filter((view) => view.kind === "inbox/intentSettled");
}

/**
 * The settle messages of a paper swap the agent runtime proposed and the owner confirmed, with the
 * owner's language `locale` (the test agent's), as pushed; `inbox/list` answers the same.
 */
export async function confirmedSwapSettles(locale: Locale): Promise<readonly InboxMessageView[]> {
  const test = await startTestEngine({ agent: { locale } });
  const { handlers } = test.engine;
  const proposed = expectOk(await handlers["intent/propose"](testCall(testSwap(), runtime)));
  const card = idSchema("crd").parse(proposed.card?.card);
  const answer = testCall({ intent: proposed.intent, card, cardVersion: 1 });
  expect(expectOk(await handlers["intent/confirm"](answer)).state).toBe("paper_filled");
  const pushed = settlesOf(test);
  const listed = expectOk(await handlers["inbox/list"](testCall({}, runtime))).items;
  expect(listed).toStrictEqual(pushed);
  return pushed;
}
