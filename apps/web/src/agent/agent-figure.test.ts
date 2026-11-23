import { describe, expect, it } from "vitest";
import { agentFigureSvg, figureBox } from "./agent-figure";
import { markOutline } from "./mark-field";

describe("agentFigureSvg", () => {
  it("draws the mark's outline, its engraving and the core in one framed SVG", () => {
    const svg = agentFigureSvg();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="${String(figureBox.x)} ${String(figureBox.y)}`);
    expect(svg).toContain(markOutline);
    expect(svg).toContain('<circle r="38" fill="#f0b90b"/>');
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("turns the needle to the resting agent's angle", () => {
    expect(agentFigureSvg()).toContain("rotate(-34.00)");
  });
});
