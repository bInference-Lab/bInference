// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../testing/render-signed-in";
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

describe("the console's system pages", () => {
  it("names one System entry in the sections, and its four pages beneath it", async () => {
    await systemNavAt("/plugins", "en");
    const sections = screen.getByRole("navigation", { name: "Console sections" });
    expect(linkNames(sections)).toStrictEqual([
      "Confirmations",
      "Chat",
      "Portfolio",
      "Ledger",
      "Auto orders",
      "Limits",
      "Safety",
      "Alert rules",
      "System",
    ]);
    expect(within(sections).getByRole("link", { name: "System" }).ariaCurrent).toBe("page");
    const pages = screen.getByRole("navigation", { name: "System pages" });
    expect(linkNames(pages)).toStrictEqual(["Skills", "Plugins", "Logs", "Checks"]);
    expect(within(pages).getByRole("link", { name: "Plugins" }).ariaCurrent).toBe("page");
    expect(screen.getByRole("heading", { level: 1, name: "Plugins" })).toBeDefined();
  });

  it("opens the skills from the System entry, and another page from beneath it", async () => {
    await systemNavAt("/", "en");
    expect(screen.queryByRole("navigation", { name: "System pages" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "System" }));
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "Skills" })).toBeDefined();
    const pages = screen.getByRole("navigation", { name: "System pages" });
    fireEvent.click(within(pages).getByRole("link", { name: "Logs" }));
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "Logs" })).toBeDefined();
    expect(within(pages).getByRole("link", { name: "Logs" }).ariaCurrent).toBe("page");
  });
});
