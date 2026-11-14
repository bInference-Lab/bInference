// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { skillsAnswers, skillsFixture } from "../testing/skills-fixture";
import { SkillsScreen } from "./skills-screen";

afterEach(cleanup);

function itemOf(name: string): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find((each) => within(each).queryByText(name) !== null);
  if (item === undefined) {
    throw new Error(`Expected ${name} in a list.`);
  }
  return item;
}

describe("the skills screen", () => {
  it("shows each proposal's changes and findings, and Apply only where no finding blocks", async () => {
    renderSignedIn(<SkillsScreen />, { client: fakeClient(skillsAnswers).client });
    await settle();
    const clean = itemOf("dip-buyer");
    expect(within(clean).getByText("Change")).toBeDefined();
    expect(within(clean).getByText("Why: You asked me to buy smaller dips.")).toBeDefined();
    expect(within(clean).getByText("- Buy a half.")).toBeDefined();
    expect(within(clean).getByText("+ Buy a tenth.")).toBeDefined();
    expect(within(clean).getByRole("button", { name: "Apply" })).toBeDefined();
    const blocked = itemOf("setup-helper");
    expect(within(blocked).getByText("SKILL.md, line 6: pipe_to_shell: curl x | sh")).toBeDefined();
    expect(within(blocked).queryByRole("button", { name: "Apply" })).toBeNull();
    expect(within(blocked).getByRole("button", { name: "Reject" })).toBeDefined();
  });

  it("asks once more before it applies, and applies nothing on Keep", async () => {
    const engine = fakeClient(skillsAnswers);
    renderSignedIn(<SkillsScreen />, { client: engine.client });
    await settle();
    const clean = itemOf("dip-buyer");
    fireEvent.click(within(clean).getByRole("button", { name: "Apply" }));
    expect(
      within(clean).getByText(
        "Apply this proposal to skill dip-buyer? It loads from the agent's next turn.",
      ),
    ).toBeDefined();
    fireEvent.click(within(clean).getByRole("button", { name: "Keep it waiting" }));
    expect(engine.calls.some(({ op }) => op === "skillProposal/apply")).toBe(false);
    fireEvent.click(within(clean).getByRole("button", { name: "Apply" }));
    fireEvent.click(within(clean).getByRole("button", { name: "Apply it" }));
    await settle();
    const applied = engine.calls.filter(({ op }) => op === "skillProposal/apply");
    expect(applied.map(({ args }) => args)).toStrictEqual([{ proposal: skillsFixture.clean }]);
  });

  it("lists the skills the agent can load, with what each is and where it came from", async () => {
    renderSignedIn(<SkillsScreen />, { client: fakeClient(skillsAnswers).client });
    await settle();
    const installed = screen.getByRole("region", { name: "Installed skills" });
    const names = within(installed)
      .getAllByRole("listitem")
      .map((item) => item.querySelector("[data-slot=card-title]")?.textContent);
    expect(names).toStrictEqual(["grid-trader", "my-notes", "safe-swap"]);
    const bundled = itemOf("safe-swap");
    expect(within(bundled).getByText("Checks a token before a swap.")).toBeDefined();
    expect(within(bundled).getByText("Comes with binference.")).toBeDefined();
    expect(itemOf("grid-trader").textContent).toContain(
      `Installed from npm:grid-trader@1.0.0 on Nov 2, 2026, 08:00:00, pinned to SHA-256 ${skillsFixture.hash}.`,
    );
    expect(itemOf("my-notes").textContent).toContain(
      "In the workspace of main, at workspace/my-notes/SKILL.md.",
    );
    expect(within(installed).queryByText("planted")).toBeNull();
  });

  it("shows no waiting skills heading while no workspace skill waits", async () => {
    const engine = fakeClient({ ...skillsAnswers, "skill/list": () => ({ items: [] }) });
    renderSignedIn(<SkillsScreen />, { client: engine.client });
    await settle();
    expect(screen.getByRole("heading", { name: "Installed skills" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Waiting workspace skills" })).toBeNull();
  });

  it("accepts a waiting skill at the hash the list read, after asking once more", async () => {
    const engine = fakeClient(skillsAnswers);
    renderSignedIn(<SkillsScreen />, { client: engine.client });
    await settle();
    const planted = itemOf("planted");
    expect(
      within(planted).getByText(
        "New or changed, so it does not load. Check its files at workspace/planted/SKILL.md first.",
      ),
    ).toBeDefined();
    fireEvent.click(within(planted).getByRole("button", { name: "Accept" }));
    fireEvent.click(within(planted).getByRole("button", { name: "Accept it" }));
    await settle();
    const accepted = engine.calls.filter(({ op }) => op === "skill/accept");
    expect(accepted.map(({ args }) => args)).toStrictEqual([
      { agent: skillsFixture.agent, skill: "planted", hash: skillsFixture.hash },
    ]);
  });
});
