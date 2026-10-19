// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { type FakeAnswers, fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const topic = `chat:${agent}` as const;
const question = "qst_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const view = {
  question,
  agent,
  session: "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  text: "How long do you like to hold a token?",
  choices: ["Minutes", "Hours", "Days", "Weeks"],
  state: "open",
  createdAt: 1,
  closesAt: 86_400_001,
};

// The engine's answers, with the open question `chat/openQuestion` reads now.
function engineWith(open: () => object, extra: FakeAnswers = {}) {
  return fakeClient({
    "agent/list": () => ({
      items: [{ agent, name: "main", mode: "paper", locale: "en", createdAt: 1, changedAt: 1 }],
    }),
    "chat/messages": () => ({ items: [] }),
    "intent/list": () => ({ items: [] }),
    "chat/openQuestion": open,
    "chat/answer": () => ({ session: view.session, turn: view.turn }),
    ...extra,
  });
}

function questionCard(): HTMLElement {
  return screen.getByRole("region", { name: "main asks" });
}

describe("the agent's question in the chat", () => {
  it("shows a question asked before the page opened, and answers it with a button", async () => {
    const state: { open: object } = { open: { question: view } };
    const engine = engineWith(() => state.open);
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    expect(questionCard().textContent).toBe(
      "main asksHow long do you like to hold a token?MinutesHoursDaysWeeksOr write your own answer.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Hours" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "chat/answer")).toStrictEqual([
      { op: "chat/answer", args: { agent, question, choice: 1 } },
    ]);
    state.open = {};
    const answer = { choice: 1, surface: "console", at: 2 };
    act(() =>
      engine.push(topic, "chat/questionClosed", { agent, question, state: "answered", answer }),
    );
    await settle();
    expect(screen.queryByRole("button", { name: "Hours" })).toBeNull();
    expect(questionCard().textContent).toContain("Answered: Hours");
  });

  it("shows a question as its push arrives", async () => {
    const state: { open: object } = { open: {} };
    const engine = engineWith(() => state.open);
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    expect(screen.queryByRole("region", { name: "main asks" })).toBeNull();
    state.open = { question: view };
    act(() => engine.push(topic, "chat/question", view));
    await settle();
    expect(screen.getByRole("button", { name: "Weeks" })).toBeDefined();
  });

  it.each([
    [
      { state: "answered", answer: { typed: "Days, mostly", surface: "telegram", at: 2 } },
      "Answered in the chat",
    ],
    [{ state: "closed", closeReason: "expired" }, "Closed: it waited 24 hours"],
    [{ state: "closed", closeReason: "replaced" }, "Closed: main asked a newer question"],
    [{ state: "closed", closeReason: "cleared" }, "Closed: the chat was cleared"],
  ])("says how a question ended: %o", async (ended, line) => {
    const state: { open: object } = { open: { question: view } };
    const engine = engineWith(() => state.open);
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    state.open = {};
    act(() => engine.push(topic, "chat/questionClosed", { agent, question, ...ended }));
    await settle();
    expect(screen.queryAllByRole("button", { name: /Minutes|Hours|Days|Weeks/ })).toStrictEqual([]);
    expect(questionCard().textContent).toContain(line);
  });

  it("says a question is closed when the engine refuses the press", async () => {
    const closed = Object.assign(new Error("closed"), { code: "question.closed" });
    const engine = engineWith(() => ({ question: view }), {
      "chat/answer": async () => Promise.reject(closed),
    });
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Days" }));
    await settle();
    expect(screen.getByRole("status").textContent).toBe("This question is closed.");
  });
});
