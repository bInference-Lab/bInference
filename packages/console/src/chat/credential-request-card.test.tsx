// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const topic = `chat:${agent}` as const;
const request = "crq_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const view = {
  request,
  agent,
  session: "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  name: "DUNE_API_KEY",
  reason: "To read holder history.",
  allowedHosts: ["api.dune.com"],
  createdAt: 1,
  closesAt: 900_001,
};
const turn = { session: view.session, turn: view.turn };

function engineWith(state: { open: object }) {
  return fakeClient({
    "agent/list": () => ({
      items: [{ agent, name: "main", mode: "paper", locale: "en", createdAt: 1, changedAt: 1 }],
    }),
    "chat/messages": () => ({ items: [] }),
    "intent/list": () => ({ items: [] }),
    "chat/openQuestion": () => ({}),
    "chat/openCredentialRequest": () => state.open,
    "credential/answer": () => turn,
    "credential/skip": () => turn,
  });
}

describe("a credential request in the console", () => {
  it("takes the value in a masked field with the hosts the owner edits, and sends it once", async () => {
    const state = { open: { request: view } as object };
    const engine = engineWith(state);
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    const card = screen.getByRole("region", { name: "Credential request" });
    expect(card.textContent).toContain("main asks for the credential DUNE_API_KEY");
    const value = screen.getByLabelText("Value (hidden as you type)");
    expect(value.getAttribute("type")).toBe("password");
    fireEvent.change(value, { target: { value: "s3cret" } });
    fireEvent.change(screen.getByLabelText("Hosts it may be sent to, one per line"), {
      target: { value: "api.dune.com\nAPI.Example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Store" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "credential/answer")).toStrictEqual([
      {
        op: "credential/answer",
        args: {
          agent,
          request,
          value: "s3cret",
          allowedHosts: ["api.dune.com", "api.example.com"],
        },
      },
    ]);
    state.open = {};
    act(() =>
      engine.push(topic, "chat/credentialRequestClosed", { agent, request, outcome: "stored" }),
    );
    await settle();
    expect(screen.queryByRole("region", { name: "Credential request" })).toBeNull();
  });

  it("skips a request", async () => {
    const engine = engineWith({ open: { request: view } });
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "credential/skip")).toStrictEqual([
      { op: "credential/skip", args: { agent, request } },
    ]);
  });
});
