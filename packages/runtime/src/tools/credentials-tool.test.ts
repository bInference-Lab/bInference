import { BinferenceError } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, callTool, outcomeOf, toolTurn } from "../testing/agent-tool-fixtures.js";

const request = {
  request: "crq_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  agent,
  session: toolTurn.session,
  turn: toolTurn.turn,
  name: "DUNE_API_KEY",
  reason: "Holder history.",
  allowedHosts: ["api.dune.com"],
  createdAt: 1,
  closesAt: 900_001,
};

describe("the credentials tool", () => {
  it("asks the owner for a credential and ends the turn, never holding a value", async () => {
    const args = {
      action: "request",
      name: "DUNE_API_KEY",
      reason: "Holder history.",
      allowedHosts: ["api.dune.com"],
    };
    const run = callTool({ "turn/credential": request }, { name: "credentials", args });
    const outcome = await outcomeOf(run);
    expect(run.client.calls()).toStrictEqual([
      {
        op: "turn/credential",
        args: {
          agent,
          session: toolTurn.session,
          turn: toolTurn.turn,
          name: "DUNE_API_KEY",
          reason: "Holder history.",
          allowedHosts: ["api.dune.com"],
        },
      },
    ]);
    expect(outcome).toMatchObject({ isError: false, endsTurn: true });
    expect(outcome.text).toContain("Never ask for the value in the chat.");
  });

  it("lists names and hosts only", async () => {
    const items = [
      { name: "A_KEY", allowedHosts: [], updatedAt: 1 },
      { name: "B_KEY", allowedHosts: ["b.example.com"], updatedAt: 2 },
    ];
    const outcome = await outcomeOf(
      callTool({ "credential/list": { items } }, { name: "credentials", args: { action: "list" } }),
    );
    expect(outcome.text).toBe(
      "Stored credentials (names and hosts only):\nA_KEY: hosts none\nB_KEY: hosts b.example.com",
    );
    const none = await outcomeOf(
      callTool(
        { "credential/list": { items: [] } },
        { name: "credentials", args: { action: "list" } },
      ),
    );
    expect(none.text).toBe("No credential is stored.");
  });

  it("removes one by name, and asks for a name when none is given", async () => {
    const removed = callTool(
      { "credential/delete": { name: "A_KEY" } },
      { name: "credentials", args: { action: "delete", name: "A_KEY" } },
    );
    expect((await outcomeOf(removed)).text).toBe("Removed the credential A_KEY.");
    const nameless = await outcomeOf(
      callTool({}, { name: "credentials", args: { action: "delete" } }),
    );
    expect(nameless.isError).toBe(true);
  });

  it("says how to name a credential when the engine refuses one", async () => {
    const refused = new BinferenceError({ code: "credential.not_found", message: "Gone." });
    const outcome = await outcomeOf(
      callTool(
        { "credential/delete": refused },
        { name: "credentials", args: { action: "delete", name: "X_KEY" } },
      ),
    );
    expect(outcome).toStrictEqual({ text: "No credential of that name is stored.", isError: true });
    const bad = await outcomeOf(
      callTool({}, { name: "credentials", args: { action: "request", name: "lower" } }),
    );
    expect(bad.text).toContain("as an environment variable is named");
  });
});
