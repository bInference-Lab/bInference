// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeAnswers, fakeClient } from "../testing/fake-client";
import { higherDayCap, limitsAgents, limitsFixture, limitsWith } from "../testing/limits-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { LimitsScreen } from "./limits-screen";

afterEach(cleanup);

const { agent } = limitsFixture;

function engineWith(answers: FakeAnswers) {
  return fakeClient({
    "agent/list": () => limitsAgents,
    "limit/get": () => limitsWith(),
    ...answers,
  });
}

// Picks a limit in main's form, types its new value and sends it.
function change(field: string, value: string): void {
  const form = within(screen.getByRole("form", { name: "Change a limit of main" }));
  fireEvent.change(form.getByLabelText("Limit"), { target: { value: field } });
  fireEvent.change(form.getByLabelText("New value"), { target: { value } });
  fireEvent.click(form.getByRole("button", { name: "Change limit" }));
}

function setCalls(engine: ReturnType<typeof engineWith>) {
  return engine.calls.filter(({ op }) => op === "limit/set");
}

describe("the limits screen's changes", () => {
  it("shows a limit's value in its unit, and applies a stricter one at once", async () => {
    const engine = engineWith({
      "limit/set": () => limitsWith({ slippageRegistryBps: 25 }),
    });
    renderSignedIn(<LimitsScreen />, { client: engine.client });
    await settle();
    const form = within(screen.getByRole("form", { name: "Change a limit of main" }));
    expect(form.getByLabelText<HTMLInputElement>("New value").value).toBe("50");
    expect(form.getByText("In dollars, such as 50")).toBeDefined();
    fireEvent.change(form.getByLabelText("Limit"), { target: { value: "slippageRegistryBps" } });
    expect(form.getByLabelText<HTMLInputElement>("New value").value).toBe("0.5");
    expect(form.getByText("In percent, such as 0.5")).toBeDefined();

    change("slippageRegistryBps", "0.25");
    await settle();
    expect(setCalls(engine)).toStrictEqual([
      { op: "limit/set", args: { agent, changes: { slippageRegistryBps: 25 } } },
    ]);
    expect(screen.getByText("Slippage limit on verified tokens is now 0.25%.")).toBeDefined();
  });

  it("shows the 24-hour wait of a looser limit, when it ends, and the change that waits", async () => {
    let view = limitsWith();
    const engine = engineWith({
      "limit/get": () => view,
      "limit/set": () => {
        view = limitsWith(higherDayCap);
        return view;
      },
    });
    renderSignedIn(<LimitsScreen />, { client: engine.client });
    await settle();
    change("rollingDayUsdMicros", "400");
    await settle();
    expect(setCalls(engine)).toStrictEqual([
      { op: "limit/set", args: { agent, changes: { rollingDayUsdMicros: 400_000_000n } } },
    ]);
    expect(
      screen.getByText(
        "24-hour cap becomes $400.00 at Jan 16, 2027, 08:00:00. Every surface announces it, and you can cancel it until then.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "From then" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "$400.00" })).toBeDefined();
  });

  it("cancels the looser limits that wait, keeps those in effect, and drops their line", async () => {
    let view = limitsWith(higherDayCap);
    const engine = engineWith({
      "limit/get": () => view,
      "limit/set": () => view,
      "limit/cancelPending": () => {
        view = limitsWith();
        return view;
      },
    });
    renderSignedIn(<LimitsScreen />, { client: engine.client });
    await settle();
    expect(
      screen.getByText(
        "Looser limits that apply at Jan 16, 2027, 08:00:00 unless you cancel them:",
      ),
    ).toBeDefined();
    change("rollingDayUsdMicros", "400");
    await settle();
    expect(screen.getByText(/^24-hour cap becomes \$400\.00 at/u)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancel the looser limits" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "limit/cancelPending")).toStrictEqual([
      { op: "limit/cancelPending", args: { agent } },
    ]);
    expect(
      screen.getByText(
        "The looser limits are cancelled, and the limits in effect stay. Every surface announces it.",
      ),
    ).toBeDefined();
    expect(screen.queryByText(/^24-hour cap becomes/u)).toBeNull();
  });

  it("says what a refused change answers, in the words of its code", async () => {
    const refused = Object.assign(new Error("limit/set"), { code: "limit.over_ceiling" });
    const engine = engineWith({
      "limit/set": () => {
        throw refused;
      },
    });
    renderSignedIn(<LimitsScreen />, { client: engine.client });
    await settle();
    change("venues", "pancakeswap, kyberswap");
    await settle();
    expect(setCalls(engine)).toStrictEqual([
      { op: "limit/set", args: { agent, changes: { venues: ["pancakeswap", "kyberswap"] } } },
    ]);
    expect(
      screen.getByText(
        "Not changed: This limit is above the wallet's ceiling. Raise the ceiling with your owner key first.",
      ),
    ).toBeDefined();
  });

  it("refuses a value the limit cannot take before anything is sent", async () => {
    const engine = engineWith({});
    renderSignedIn(<LimitsScreen />, { client: engine.client });
    await settle();
    change("perTradeUsdMicros", "fifty");
    await settle();
    expect(setCalls(engine)).toStrictEqual([]);
    expect(
      screen.getByText(
        "Per-trade cap does not take this value. Write it as the line under the field says.",
      ),
    ).toBeDefined();
  });

  it("changes limits in the Mini App, and only reads them without confirm", async () => {
    const miniApp = engineWith({});
    renderSignedIn(<LimitsScreen />, {
      client: miniApp.client,
      scopes: ["read", "chat", "confirm", "loosen"],
    });
    await settle();
    expect(screen.getByRole("form", { name: "Change a limit of main" })).toBeDefined();
    cleanup();

    const reader = engineWith({ "limit/get": () => limitsWith(higherDayCap) });
    renderSignedIn(<LimitsScreen />, { client: reader.client, scopes: ["read"] });
    await settle();
    expect(
      screen.getByText("This connection can read the limits but not change them."),
    ).toBeDefined();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
