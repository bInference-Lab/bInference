// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const question = "qst_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const view = {
  question,
  agent,
  session: "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  text: "你通常持有一个代币多久？",
  choices: ["几分钟", "几小时", "几天", "几周"],
  state: "open",
  createdAt: 1,
  closesAt: 86_400_001,
};

describe("the agent's question in the chat, in Chinese", () => {
  it("speaks the owner's language, and says when a question waited 24 hours", async () => {
    const state: { open: object } = { open: { question: view } };
    const engine = fakeClient({
      "agent/list": () => ({
        items: [{ agent, name: "main", mode: "paper", locale: "zh", createdAt: 1, changedAt: 1 }],
      }),
      "chat/messages": () => ({ items: [] }),
      "intent/list": () => ({ items: [] }),
      "chat/openQuestion": () => state.open,
    });
    renderSignedIn(<ChatScreen />, { client: engine.client, locale: "zh" });
    await settle();
    const card = screen.getByRole("region", { name: "main 想问你" });
    expect(card.textContent).toBe(
      "main 想问你你通常持有一个代币多久？几分钟几小时几天几周也可以直接输入你的回答。",
    );
    state.open = {};
    const closed = { agent, question, state: "closed", closeReason: "expired" };
    act(() => engine.push(`chat:${agent}`, "chat/questionClosed", closed));
    await settle();
    expect(screen.getByRole("region", { name: "main 想问你" }).textContent).toContain(
      "已关闭：已等待 24 小时",
    );
  });
});
