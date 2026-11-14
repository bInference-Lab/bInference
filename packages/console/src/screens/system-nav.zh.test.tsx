// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { linkNames, systemNavAt } from "../testing/system-nav-fixture";

beforeEach(() => {
  // The router restores the scroll on each page, which jsdom does not lay out.
  vi.spyOn(globalThis, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  globalThis.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

it("names the System entry and its pages in Chinese", async () => {
  await systemNavAt("/skills", "zh");
  const sections = screen.getByRole("navigation", { name: "控制台栏目" });
  expect(within(sections).getByRole("link", { name: "系统" }).ariaCurrent).toBe("page");
  const pages = screen.getByRole("navigation", { name: "系统页面" });
  expect(linkNames(pages)).toStrictEqual(["技能", "插件", "日志", "检查"]);
});
