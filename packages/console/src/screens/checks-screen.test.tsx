// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { checksAnswers, checksFixture } from "../testing/checks-fixture";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ChecksScreen } from "./checks-screen";

afterEach(cleanup);

function opsOf(calls: readonly { readonly op: string; readonly args: object }[], op: string) {
  return calls.filter((call) => call.op === op).map(({ args }) => args);
}

describe("the checks screen", () => {
  it("runs the checks when asked and shows the report in the terminal's words", async () => {
    const engine = fakeClient(checksAnswers);
    renderSignedIn(<ChecksScreen />, { client: engine.client });
    await settle();
    expect(opsOf(engine.calls, "check/run")).toStrictEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Run the checks" }));
    await settle();
    engine.push("job", "job/done", checksFixture.done);
    await settle();
    expect(opsOf(engine.calls, "check/run")).toStrictEqual([{}]);
    expect(screen.getByText("5 checks ran: 1 problem and 1 warning.")).toBeDefined();
    expect(
      screen.getByText(
        "Checked at Nov 14, 2026, 08:30:00. For a minute, running them again shows this result.",
      ),
    ).toBeDefined();
    const problems = screen.getByRole("region", { name: "Problems" });
    expect(problems.textContent).toContain(
      "permissions.config_fileOther accounts on this machine can open state/config.json5. Run binference check --fix to make it yours alone.",
    );
    const warnings = screen.getByRole("region", { name: "Warnings" });
    expect(warnings.textContent).toContain(
      "router/eyes: its provider reports no cost, and neither models.prices nor the built-in table prices it",
    );
    const notes = screen.getByRole("region", { name: "Good to know" });
    expect(
      within(notes).getByText("router/eyes reads images: your images go to it."),
    ).toBeDefined();
    const rest = screen.getByRole("region", { name: "The other checks" });
    expect(within(rest).getByRole("list").textContent).toBe("config.validFinerpc.keyedNot checked");
    expect(screen.getByRole("button", { name: "Run the checks again" })).toBeDefined();
  });

  it("says why the checks did not finish in the code's words", async () => {
    const engine = fakeClient(checksAnswers);
    renderSignedIn(<ChecksScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Run the checks" }));
    await settle();
    engine.push("job", "job/failed", checksFixture.failed);
    await settle();
    expect(screen.getByRole("alert").textContent).toBe(
      "The checks did not finish: binference did not finish in time. Try again.",
    );
  });

  it("ignores the end of another job", async () => {
    const engine = fakeClient(checksAnswers);
    renderSignedIn(<ChecksScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Run the checks" }));
    await settle();
    engine.push("job", "job/done", { ...checksFixture.done, job: "job_other" });
    await settle();
    expect(screen.queryByRole("region", { name: "Problems" })).toBeNull();
    expect(screen.getByText("The checks have not run from here yet.")).toBeDefined();
  });

  it("tells a connection without admin where to run the checks, and runs nothing", async () => {
    const engine = fakeClient(checksAnswers);
    renderSignedIn(<ChecksScreen />, {
      client: engine.client,
      scopes: ["read", "chat", "confirm", "loosen"],
    });
    await settle();
    expect(screen.queryByRole("button", { name: "Run the checks" })).toBeNull();
    expect(screen.getByText(/^This connection cannot run the checks\./u)).toBeDefined();
    expect(opsOf(engine.calls, "check/run")).toStrictEqual([]);
  });
});
