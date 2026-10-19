// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ChatScreen } from "./chat-screen";

afterEach(cleanup);

// jsdom makes no object URLs; a preview's address only has to exist.
Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => undefined });

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";

describe("the chat screen, in Chinese", () => {
  it("speaks the owner's language, the running turn too", async () => {
    const engine = fakeClient({
      "agent/list": () => ({
        items: [{ agent, name: "main", mode: "paper", locale: "zh", createdAt: 1, changedAt: 1 }],
      }),
      "chat/messages": () => ({ items: [] }),
      "intent/list": () => ({ items: [] }),
    });
    renderSignedIn(<ChatScreen />, { client: engine.client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { name: "对话" })).toBeDefined();
    expect(screen.getByRole("log", { name: "与 main 的对话" })).toBeDefined();
    expect(screen.getByText("还没有消息。可以问 Agent 某个代币，或让它交易。")).toBeDefined();
    const started = {
      agent,
      session: "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001",
      turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    };
    act(() => engine.push(`chat:${agent}`, "chat/turnStarted", started));
    expect(screen.getByText("处理中 · 0 秒")).toBeDefined();
    expect(screen.getByRole("button", { name: "停止" })).toBeDefined();
    const box = screen.getByRole("textbox", { name: "发给 Agent 的消息" });
    expect(box.getAttribute("placeholder")).toBe("给 main 发消息…");
    const gif = new File([new Uint8Array(6)], "cat.gif", { type: "image/gif" });
    fireEvent.paste(box, { clipboardData: { files: [gif] } });
    expect(screen.getByRole("alert").textContent).toBe("cat.gif 不是 PNG、JPEG 或 WebP 图片。");
    expect(screen.getByRole("button", { name: "添加图片" })).toBeDefined();
  });
});
