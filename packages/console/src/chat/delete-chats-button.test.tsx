// @vitest-environment jsdom
import { protocolIdSchema } from "@binference/protocol";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { DeleteChatsButton } from "./delete-chats-button";

afterEach(cleanup);

const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");

const deleted = {
  agents: [agent],
  sessions: 1,
  turns: 3,
  events: 12,
  messages: 2,
  goals: 0,
  progressNotes: 0,
  helpers: 0,
  inboxMessages: 2,
  questions: 0,
};

describe("the chat's Delete chats", () => {
  it("asks once more, naming what goes and what stays, and keeps the chats when told", async () => {
    const engine = fakeClient({ "chat/delete": () => deleted });
    renderSignedIn(<DeleteChatsButton agent={agent} agentName="main" />, { client: engine.client });
    fireEvent.click(screen.getByRole("button", { name: "Delete chats" }));
    expect(screen.getByText(/^Delete every chat of main now\?/u).textContent).toContain(
      "Backups made before now still hold these chats until they are pruned.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep them" }));
    await settle();
    expect(engine.calls).toStrictEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete now" }));
    await settle();
    expect(engine.calls).toStrictEqual([{ op: "chat/delete", args: { agent: agent } }]);
    expect(
      screen.getByText("Deleted 1 chat with 12 messages. Notes and trades stay."),
    ).toBeDefined();
  });

  it("says why when the engine refuses, such as an agent offline", async () => {
    const offline = Object.assign(new Error("chat/delete"), { code: "chat.needs_runtime" });
    const engine = fakeClient({
      "chat/delete": () => {
        throw offline;
      },
    });
    renderSignedIn(<DeleteChatsButton agent={agent} agentName="main" />, { client: engine.client });
    fireEvent.click(screen.getByRole("button", { name: "Delete chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete now" }));
    await settle();
    expect(screen.getByText(/^Not deleted: Your agent is offline/u)).toBeDefined();
  });

  it("is not offered to a device without the admin scope", () => {
    const { client } = fakeClient({});
    renderSignedIn(<DeleteChatsButton agent={agent} agentName="main" />, {
      client,
      scopes: ["read", "chat", "confirm"],
    });
    expect(screen.queryByRole("button", { name: "Delete chats" })).toBeNull();
  });
});
