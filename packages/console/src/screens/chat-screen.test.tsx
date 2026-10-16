// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleRoutes } from "../app/console-router";
import { type FakeAnswers, fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ChatScreen } from "./chat-screen";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const session = "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001";

const mainAgent = { agent, name: "main", mode: "paper", locale: "en", createdAt: 1, changedAt: 1 };

// One message of the open session, as the runtime reads it from its transcript.
function said(seq: number, role: string, text: string) {
  const kind = role === "tool" ? "tool_call" : "text";
  return { session, turn, seq, role, kind, text, at: seq };
}

// A character no reader sees, which the console writes out.
const hidden = String.fromCodePoint(0x200b);

function chatAnswers(extra: FakeAnswers = {}): FakeAnswers {
  return {
    "agent/list": () => ({ items: [mainAgent] }),
    "chat/messages": () => ({ items: [] }),
    "intent/list": () => ({ items: [] }),
    ...extra,
  };
}

describe("the chat screen", () => {
  it("shows the open session's messages of the owner and the agent, without tool calls", async () => {
    const engine = fakeClient(
      chatAnswers({
        "chat/messages": () => ({
          items: [
            said(1, "owner", "Buy CAKE"),
            said(2, "tool", "swap {}"),
            said(3, "agent", `A card waits.${hidden}`),
          ],
        }),
      }),
    );
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    const log = screen.getByRole("log", { name: "Chat with main" });
    expect([...log.querySelectorAll("p")].map((line) => line.textContent)).toStrictEqual([
      "Buy CAKE",
      "A card waits.\\u{200B}",
    ]);
    expect(engine.calls.find((call) => call.op === "chat/messages")?.args).toStrictEqual({
      agent,
      limit: 200,
    });
  });

  it("streams the agent's running turn, then shows its answer and its status lines", async () => {
    const engine = fakeClient(chatAnswers());
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    const topic = `chat:${agent}` as const;
    act(() => engine.push(topic, "chat/turnStarted", { agent, session, turn }));
    expect(screen.getByText("Working on it · 0 s")).toBeDefined();
    act(() =>
      engine.push(topic, "chat/message", { agent, session, turn, text: "Checking", final: false }),
    );
    expect(screen.getByText("Checking")).toBeDefined();
    act(() =>
      engine.push(topic, "chat/message", {
        agent,
        session,
        turn,
        text: "A card waits.",
        final: true,
      }),
    );
    act(() => engine.push(topic, "chat/status", { agent, turn, statusKey: "turn.image.noVision" }));
    act(() => engine.push(topic, "chat/turnEnded", { agent, turn, outcome: "ok" }));
    await settle();
    const log = screen.getByRole("log", { name: "Chat with main" });
    expect(log.textContent).toContain("A card waits.");
    expect(screen.queryByText("Working on it · 0 s")).toBeNull();
    // A status line's `code` spans show as code, and a turn's end loads the transcript again.
    expect(screen.getByText("models.vision").tagName).toBe("CODE");
    expect(engine.calls.filter((call) => call.op === "chat/messages").length).toBeGreaterThan(1);
  });

  it("says the chat so far could not load while the agent runtime is down", async () => {
    const down = Object.assign(new Error("down"), { code: "runtime.unavailable" });
    const engine = fakeClient(chatAnswers({ "chat/messages": async () => Promise.reject(down) }));
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    expect(screen.getByRole("alert").textContent).toMatch(/^The chat so far could not load\./u);
  });

  it("is the same screen in the Mini App, under its own path", async () => {
    const scroll = vi.spyOn(globalThis, "scrollTo").mockImplementation(() => undefined);
    globalThis.history.replaceState(null, "", "/mini/chat");
    const engine = fakeClient(chatAnswers());
    const scopes = ["read", "chat", "confirm", "loosen"] as const;
    renderSignedIn(<ConsoleRoutes basepath="/mini" />, { client: engine.client, scopes });
    await settle();
    expect(screen.getByRole("heading", { name: "Chat" })).toBeDefined();
    expect(screen.getByRole("log", { name: "Chat with main" })).toBeDefined();
    globalThis.history.replaceState(null, "", "/");
    scroll.mockRestore();
  });
});
