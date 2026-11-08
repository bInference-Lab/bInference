// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { type FakeAnswers, fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const session = "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const mainAgent = { agent, name: "main", mode: "paper", locale: "en", createdAt: 1, changedAt: 1 };

const goal = {
  agent,
  session,
  objective: "Find three tokens",
  status: "active",
  spentUsdMicros: "1250000",
  budgetUsdMicros: "5000000",
  goalTurns: 4,
  startedAt: 1,
  updatedAt: 2,
};

const note = {
  agent,
  session,
  markdown: "2 of 3 found.",
  plan: [
    { text: "Scan", state: "done" },
    { text: "Report", state: "todo" },
  ],
  updatedAt: 3,
};

function answers(read: { current: object }): FakeAnswers {
  return {
    "agent/list": () => ({ items: [mainAgent] }),
    "chat/messages": () => ({ items: [] }),
    "intent/list": () => ({ items: [] }),
    "chat/openQuestion": () => ({}),
    "goal/get": () => read.current,
    "goal/change": () => ({}),
  };
}

describe("the goal panel", () => {
  it("shows the chat's goal and progress note, and pauses the goal from its button", async () => {
    const read = { current: { goal, note } as object };
    const engine = fakeClient(answers(read));
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    const panel = screen.getByRole("region", { name: "Goal of this chat" });
    expect(within(panel).getByText("Goal (active): Find three tokens")).toBeDefined();
    expect(within(panel).getByText("Spent: $1.25 of $5.00.")).toBeDefined();
    expect(within(panel).getByText("1. Scan (done)")).toBeDefined();
    expect(within(panel).queryByRole("button", { name: "Resume goal" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Pause goal" }));
    await settle();
    expect(engine.calls.find((call) => call.op === "goal/change")?.args).toStrictEqual({
      agent,
      action: "pause",
    });
  });

  it("reads the goal again at a goal push, and shows nothing for a chat without one", async () => {
    const read = { current: {} as object };
    const engine = fakeClient(answers(read));
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    expect(screen.queryByRole("region", { name: "Goal of this chat" })).toBeNull();
    const paused = { ...goal, status: "paused", pauseReason: "owner" };
    read.current = { goal: paused };
    act(() =>
      engine.push(`chat:${agent}`, "chat/goal", {
        agent,
        session,
        change: "paused",
        goal: paused,
      }),
    );
    await settle();
    const panel = screen.getByRole("region", { name: "Goal of this chat" });
    expect(within(panel).getByRole("button", { name: "Resume goal" })).toBeDefined();
  });
});
