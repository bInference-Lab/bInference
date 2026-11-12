// @vitest-environment jsdom
import { protocolIdSchema } from "@binference/protocol";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { DeleteChatsButton } from "./delete-chats-button";

afterEach(cleanup);

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");

describe("the chat's Delete chats, in Chinese", () => {
  it("asks in Chinese, naming what stays, and says what it deleted", async () => {
    const engine = fakeClient({
      "chat/delete": () => ({
        agents: [agent],
        sessions: 2,
        turns: 3,
        events: 12,
        messages: 0,
        goals: 0,
        progressNotes: 0,
        helpers: 0,
        inboxMessages: 0,
        questions: 0,
      }),
    });
    renderSignedIn(<DeleteChatsButton agent={agent} agentName="main" />, {
      client: engine.client,
      locale: "zh",
    });
    fireEvent.click(screen.getByRole("button", { name: "删除对话" }));
    expect(screen.getByText(/^立即删除 main 的每个对话？/u).textContent).toContain(
      "此前生成的备份在被清理前仍保留这些对话。",
    );
    fireEvent.click(screen.getByRole("button", { name: "立即删除" }));
    await settle();
    expect(screen.getByText("已删除 2 个对话，包括 12 条消息。笔记和交易都会保留。")).toBeDefined();
  });
});
