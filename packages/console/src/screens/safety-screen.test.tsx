// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeAnswers, fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import {
  agentList,
  cardAnswers,
  mainFrozen,
  nothingFrozen,
  rescueWaiting,
  safetyFixture,
  unfreezeWaiting,
} from "../testing/safety-fixture";
import { SafetyScreen } from "./safety-screen";

afterEach(cleanup);

const { main, scout, unfreezeIntent, unfreezeCard, rescueIntent } = safetyFixture;
const frozenAt = "Jan 15, 2027, 08:00:00";

// The engine as the safety screen reads it: the status, the agents, and the cards that wait,
// which an unfreeze or a rescue the test calls opens.
function engineWith(status: object, more: FakeAnswers = {}) {
  const waiting: object[] = [];
  return fakeClient({
    "safety/status": () => status,
    "agent/list": () => agentList,
    "intent/list": () => ({ items: waiting }),
    "safety/unfreeze": () => {
      waiting.push(unfreezeWaiting);
      return { intent: unfreezeIntent };
    },
    "safety/rescue": () => {
      waiting.push(rescueWaiting);
      return { intent: rescueIntent };
    },
    "safety/freeze": () => ({ frozenAt: safetyFixture.frozenAt }),
    "intent/confirm": () => {
      waiting.splice(0);
      return { intent: unfreezeIntent, state: "reconciled" };
    },
    ...cardAnswers,
    ...more,
  });
}

function sectionNamed(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("the safety screen's freeze", () => {
  it("asks once more before it freezes every agent, and keeps trading when told", async () => {
    const engine = engineWith(nothingFrozen);
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    expect(screen.getByText(/^Nothing is frozen\. A freeze stops trading at once/u)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Freeze every agent" }));
    expect(screen.getByText(/^Freeze every agent now\?/u).textContent).toContain(
      "Every agent made until an unfreeze starts frozen.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep trading" }));
    await settle();
    expect(engine.calls.map(({ op }) => op)).not.toContain("safety/freeze");

    fireEvent.click(screen.getByRole("button", { name: "Freeze every agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Freeze now" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "safety/freeze")).toStrictEqual([
      { op: "safety/freeze", args: {} },
    ]);
    expect(screen.getByText(`Frozen since ${frozenAt}. Every surface announces it.`)).toBeDefined();
  });

  it("freezes one agent after asking, naming it", async () => {
    const engine = engineWith(mainFrozen);
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    const agents = within(screen.getByRole("list", { name: "Agents" }));
    expect(agents.getByText(`Frozen since ${frozenAt}`)).toBeDefined();
    expect(agents.getByText("Not frozen")).toBeDefined();
    fireEvent.click(agents.getByRole("button", { name: "Freeze scout" }));
    expect(screen.getByText(/^Freeze scout now\? Its open cards/u)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Freeze now" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "safety/freeze")).toStrictEqual([
      { op: "safety/freeze", args: { agent: scout } },
    ]);
  });

  it("opens the unfreeze card, whose Confirm answers the version it shows and closes it", async () => {
    const engine = engineWith(mainFrozen);
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Unfreeze main" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "safety/unfreeze")).toStrictEqual([
      { op: "safety/unfreeze", args: { agent: main } },
    ]);
    expect(screen.getByText(/^The unfreeze card waits below\./u)).toBeDefined();
    const card = within(sectionNamed("The unfreeze card"));
    expect(card.getByText("Unfreeze main: it trades again within its limits")).toBeDefined();
    fireEvent.click(card.getByRole("button", { name: "Confirm" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "intent/confirm")).toStrictEqual([
      {
        op: "intent/confirm",
        args: { intent: unfreezeIntent, card: unfreezeCard, cardVersion: 1 },
      },
    ]);
    expect(screen.queryByText(/^The unfreeze card waits below\./u)).toBeNull();
  });

  it("asks for an unfreeze of every agent, and says when nothing is frozen", async () => {
    const engine = engineWith(mainFrozen, { "safety/unfreeze": () => ({}) });
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Unfreeze every agent" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "safety/unfreeze")).toStrictEqual([
      { op: "safety/unfreeze", args: {} },
    ]);
    expect(screen.getByText("Nothing is frozen, so there is nothing to unfreeze.")).toBeDefined();
  });

  it("shows the breaker's words and no Unfreeze while it holds, and still freezes", async () => {
    const breaker = { ...mainFrozen, breaker: { pulledAt: safetyFixture.frozenAt } };
    const engine = engineWith(breaker);
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    expect(
      screen.getByText(/^bInference pulled its breaker, so every agent is frozen/u),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Unfreeze/u })).toBeNull();
    const agents = within(screen.getByRole("list", { name: "Agents" }));
    expect(agents.getByText("Held by bInference's breaker")).toBeDefined();
    expect(agents.getByRole("button", { name: "Freeze scout" })).toBeDefined();
  });

  it("says why when the engine refuses, in the words of its code", async () => {
    const breaker = Object.assign(new Error("safety/unfreeze"), { code: "safety.breaker" });
    const engine = engineWith(mainFrozen, {
      "safety/unfreeze": () => {
        throw breaker;
      },
    });
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Unfreeze main" }));
    await settle();
    expect(screen.getByText(/^Not done: bInference pulled its breaker/u)).toBeDefined();
  });
});

describe("the safety screen's rescue", () => {
  it("shows the rescue address in effect, the one that waits, and opens the rescue card", async () => {
    const engine = engineWith(mainFrozen);
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    const rescue = within(sectionNamed("Rescue"));
    expect(rescue.getByText(safetyFixture.rescueAddress).parentElement?.textContent).toBe(
      `Rescue address in effect: ${safetyFixture.rescueAddress}`,
    );
    expect(rescue.getByText(/^It changes to/u).parentElement?.textContent).toBe(
      `It changes to ${safetyFixture.newAddress} at Jan 16, 2027, 08:00:00. Not you? Run binference rescue cancel on the machine.`,
    );
    fireEvent.click(rescue.getByRole("button", { name: "Open the rescue card" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "safety/rescue")).toStrictEqual([
      { op: "safety/rescue", args: {} },
    ]);
    const card = within(sectionNamed("The rescue card"));
    expect(
      card.getByText(
        /^Move everything to your rescue address 0x3043…DBcB: 2 tokens from 1 wallet/u,
      ),
    ).toBeDefined();
    expect(card.getByRole("button", { name: "Confirm" })).toBeDefined();
  });

  it("names the rescue under way, and why the engine refused one", async () => {
    const underWay = { ...nothingFrozen, rescue: { intent: rescueIntent, state: "executing" } };
    const nothing = Object.assign(new Error("safety/rescue"), { code: "rescue.nothing_to_move" });
    const engine = engineWith(underWay, {
      "safety/rescue": () => {
        throw nothing;
      },
    });
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    expect(screen.getByText("A rescue is under way: sending.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open the rescue card" }));
    await settle();
    expect(screen.getByText("Not done: No agent wallet holds anything to rescue.")).toBeDefined();
  });

  it("offers no rescue without a rescue address, and says where to set one", async () => {
    const engine = engineWith({ frozen: false });
    renderSignedIn(<SafetyScreen />, { client: engine.client });
    await settle();
    expect(screen.getByText(/^No rescue address is set, so no rescue can open\./u)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Open the rescue card" })).toBeNull();
  });
});

describe("the safety screen's scopes", () => {
  it("offers every brake in the Mini App, which holds confirm and loosen", async () => {
    const engine = engineWith(mainFrozen);
    renderSignedIn(<SafetyScreen />, {
      client: engine.client,
      scopes: ["read", "chat", "confirm", "loosen"],
    });
    await settle();
    expect(screen.getByRole("button", { name: "Freeze every agent" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Unfreeze main" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Open the rescue card" })).toBeDefined();
  });

  it("only reads for a connection without confirm", async () => {
    const engine = engineWith(mainFrozen);
    renderSignedIn(<SafetyScreen />, { client: engine.client, scopes: ["read"] });
    await settle();
    expect(
      screen.getByText(
        "This connection can read what is frozen, but not freeze, unfreeze or rescue.",
      ),
    ).toBeDefined();
    expect(screen.queryAllByRole("button")).toStrictEqual([]);
  });
});
