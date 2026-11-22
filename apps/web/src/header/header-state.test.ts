import { describe, expect, it } from "vitest";
import { activeChapter, headerView } from "./header-state";

const page = { heroEnd: 900, pageEnd: 20_000 };
const shown = { y: 0, hidden: false };

describe("headerView", () => {
  it("stays open across the hero and gathers into its capsule past half of it", () => {
    expect(headerView({ ...page, y: 100 }, shown).mode).toBe("top");
    expect(headerView({ ...page, y: 600 }, shown).mode).toBe("float");
  });

  it("slips away while the reader scrolls down past the hero, and returns on the way up", () => {
    const down = headerView({ ...page, y: 1400 }, { y: 1300, hidden: false });
    expect(down.hidden).toBe(true);
    const up = headerView({ ...page, y: 1380 }, { y: 1400, hidden: true });
    expect(up.hidden).toBe(false);
  });

  it("holds still for a small move and never hides over the hero", () => {
    expect(headerView({ ...page, y: 1403 }, { y: 1400, hidden: true }).hidden).toBe(true);
    expect(headerView({ ...page, y: 300 }, { y: 100, hidden: true }).hidden).toBe(false);
  });

  it("measures the progress down the page", () => {
    expect(headerView({ ...page, y: 10_000 }, shown).progress).toBe(0.5);
    expect(headerView({ ...page, y: 30_000 }, shown).progress).toBe(1);
  });
});

describe("activeChapter", () => {
  it("names the last chapter whose top has passed the line", () => {
    expect(activeChapter([800, 2000, 3000], 400)).toBe(-1);
    expect(activeChapter([-50, 2000, 3000], 400)).toBe(0);
    expect(activeChapter([-2000, -500, 300], 400)).toBe(2);
  });
});
