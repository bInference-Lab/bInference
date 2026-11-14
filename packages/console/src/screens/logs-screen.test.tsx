// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { logsAnswers } from "../testing/logs-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { LogsScreen } from "./logs-screen";

afterEach(cleanup);

function opsOf(calls: readonly { readonly op: string; readonly args: object }[], op: string) {
  return calls.filter((call) => call.op === op).map(({ args }) => args);
}

describe("the logs screen", () => {
  it("shows the newest lines as the log writes them, and how many were left out", async () => {
    const engine = fakeClient(logsAnswers);
    renderSignedIn(<LogsScreen />, { client: engine.client });
    await settle();
    const lines = within(screen.getByRole("list", { name: "Log lines" })).getAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toStrictEqual([
      "Nov 14, 2026, 08:00:01infoengine.serverserver.listening",
      "Nov 14, 2026, 08:00:02warnengine.ordersorder.skippedorderId=ord_0190f1c2-3a4b-7c5d-8e6f-000000000001host=[omitted]",
    ]);
    expect(
      screen.getByText("2 lines were left out, since they are not in the log's JSON shape."),
    ).toBeDefined();
    expect(opsOf(engine.calls, "log/recent")).toStrictEqual([{ level: "info", limit: 200 }]);
  });

  it("reads the level the owner picks, and reads again on Reload", async () => {
    const engine = fakeClient(logsAnswers);
    renderSignedIn(<LogsScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Warnings and errors" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await settle();
    expect(opsOf(engine.calls, "log/recent")).toStrictEqual([
      { level: "info", limit: 200 },
      { level: "warn", limit: 200 },
      { level: "warn", limit: 200 },
    ]);
    expect(screen.getByRole("button", { name: "Warnings and errors" }).ariaPressed).toBe("true");
  });

  it("says older lines were left out when the engine cut them", async () => {
    const engine = fakeClient({
      "log/recent": () => ({ items: [], omitted: 0, cut: true }),
    });
    renderSignedIn(<LogsScreen />, { client: engine.client });
    await settle();
    expect(screen.getByText(/^Older lines are left out to keep this page small\./u)).toBeDefined();
    expect(screen.getByText("No log line at this level yet.")).toBeDefined();
  });

  it("tells a connection without admin where to read the logs, and reads nothing", async () => {
    const engine = fakeClient(logsAnswers);
    renderSignedIn(<LogsScreen />, {
      client: engine.client,
      scopes: ["read", "chat", "confirm", "loosen"],
    });
    await settle();
    expect(screen.getByText(/^This connection cannot read the engine's log\./u)).toBeDefined();
    expect(screen.queryByRole("list", { name: "Log lines" })).toBeNull();
    expect(opsOf(engine.calls, "log/recent")).toStrictEqual([]);
  });
});
