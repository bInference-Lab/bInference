// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const topic = `chat:${agent}` as const;
const request = "shq_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const view = {
  request,
  agent,
  job: "shj_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  command: "git status",
  folder: "/srv/project",
  reason: "unlisted",
  canAlwaysAllow: true,
  createdAt: 1,
  closesAt: 600_001,
};

function engineWith(state: { items: readonly object[] }) {
  return fakeClient({
    "agent/list": () => ({
      items: [{ agent, name: "main", mode: "paper", locale: "en", createdAt: 1, changedAt: 1 }],
    }),
    "chat/messages": () => ({ items: [] }),
    "intent/list": () => ({ items: [] }),
    "chat/openQuestion": () => ({}),
    "chat/openCredentialRequest": () => ({}),
    "shell/requests": () => ({ items: state.items }),
    "shell/answer": () => ({ outcome: "allowed_always" }),
  });
}

describe("a shell request in the console", () => {
  it("shows the command with its folder and why it asks, and sends Always allow once", async () => {
    const state = { items: [view] as readonly object[] };
    const engine = engineWith(state);
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    const card = screen.getByRole("region", { name: "Shell request" });
    expect(card.textContent).toContain("main asks to run a command");
    expect(card.textContent).toContain("git status");
    expect(card.textContent).toContain("In /srv/project");
    expect(card.textContent).toContain("No allowed command covers it.");
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "shell/answer")).toStrictEqual([
      { op: "shell/answer", args: { request, answer: "always" } },
    ]);
    state.items = [];
    act(() =>
      engine.push(topic, "chat/shellRequestClosed", { agent, request, outcome: "allowed_always" }),
    );
    await settle();
    expect(screen.queryByRole("region", { name: "Shell request" })).toBeNull();
  });

  it("offers no Always allow where it is not, and refuses", async () => {
    const unread = { ...view, reason: "unreadable", canAlwaysAllow: false };
    const engine = engineWith({ items: [unread] });
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.getByRole("region", { name: "Shell request" }).textContent).toContain(
      "Always allow is not offered",
    );
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "shell/answer")).toStrictEqual([
      { op: "shell/answer", args: { request, answer: "refuse" } },
    ]);
  });
});
