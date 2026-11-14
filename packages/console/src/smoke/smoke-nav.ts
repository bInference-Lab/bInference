import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { openPaired } from "./smoke-page";

/** Where a box sits in the window, in CSS pixels. */
interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** A link of a nav as the page lays it out: its box, its words, whether they are cut, and whether it is marked. */
interface LinkBox extends Box {
  readonly name: string;
  readonly cut: boolean;
  readonly current: boolean;
}

/** A nav as the page lays it out: its box, whether it scrolls sideways, and its links. */
interface NavBox {
  readonly box: Box;
  readonly scrolls: boolean;
  readonly links: readonly LinkBox[];
}

/** The names the page reads its navs and the System entry by, in the owner's language. */
export interface NavNames {
  readonly sections: string;
  readonly system: string;
  readonly pages: string;
}

/** The names in English. */
export const englishNav: NavNames = {
  sections: "Console sections",
  system: "System",
  pages: "System pages",
};

/** Where a phone opens a page: its address, and the heading it waits for. */
export interface PhonePage {
  readonly names: NavNames;
  readonly path: string;
  readonly heading: string;
}

// Half a pixel of rounding between boxes that touch.
const touch = 0.5;

async function navBox(page: Page, name: string): Promise<NavBox> {
  // The page runs this callback on its own, so it reaches nothing outside it.
  return page.getByRole("navigation", { name }).evaluate((nav) => {
    const { left, right, top, bottom } = nav.getBoundingClientRect();
    return {
      box: { left, right, top, bottom },
      scrolls: nav.scrollWidth > nav.clientWidth,
      links: Array.from(nav.querySelectorAll("a"), (link) => {
        const shown = link.getBoundingClientRect();
        return {
          left: shown.left,
          right: shown.right,
          top: shown.top,
          bottom: shown.bottom,
          name: link.textContent,
          cut: link.scrollWidth > link.clientWidth,
          current: link.getAttribute("aria-current") === "page",
        };
      }),
    };
  });
}

async function boxOfStatus(page: Page): Promise<Box> {
  const box = await page.getByRole("banner").getByRole("status").boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box ?? { x: 0, y: 0, width: 0, height: 0 };
  return { left: x, right: x + width, top: y, bottom: y + height };
}

// Every link of the nav stands whole on one row, each after the one before, none over another.
function expectOneRowOfWholeLinks(nav: NavBox): void {
  expect(nav.links.filter((link) => link.cut)).toStrictEqual([]);
  expect(new Set(nav.links.map((link) => link.top)).size).toBe(1);
  for (const [index, link] of nav.links.slice(1).entries()) {
    expect(link.left).toBeGreaterThanOrEqual((nav.links[index]?.right ?? 0) - touch);
  }
}

// The marked link sits wholly inside the part of the nav that shows.
function expectMarkedInView(nav: NavBox): void {
  const marked = nav.links.find((link) => link.current);
  expect(marked).toBeDefined();
  expect(marked?.left).toBeGreaterThanOrEqual(nav.box.left - touch);
  expect(marked?.right).toBeLessThanOrEqual(nav.box.right + touch);
}

/**
 * Checks a wide window: the sections stand on one line beside the brand and the connection, none
 * cut or hidden, and the System pages beneath them likewise.
 */
export async function expectSectionsOnOneLine(page: Page, names: NavNames): Promise<void> {
  const sections = await navBox(page, names.sections);
  expect(sections.scrolls).toBe(false);
  expectOneRowOfWholeLinks(sections);
  const status = await boxOfStatus(page);
  expect(status.left).toBeGreaterThanOrEqual(sections.box.right - touch);
  expect(status.top).toBeLessThan(sections.box.bottom);
  expect(status.bottom).toBeGreaterThan(sections.box.top);
  const pages = await navBox(page, names.pages);
  expect(pages.scrolls).toBe(false);
  expectOneRowOfWholeLinks(pages);
  expectMarkedInView(sections);
}

/**
 * Checks a phone's window: the sections are a row of their own below the brand and the connection
 * that scrolls sideways with the marked one in view, every word whole and nothing over another, the
 * System pages whole in the window, and the page itself never wider than the window.
 */
export async function expectSectionsScrollOnAPhone(page: Page, names: NavNames): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  const sections = await navBox(page, names.sections);
  expect(sections.box.left).toBeGreaterThanOrEqual(0);
  expect(sections.box.right).toBeLessThanOrEqual(width);
  expect(sections.scrolls).toBe(true);
  expectOneRowOfWholeLinks(sections);
  expectMarkedInView(sections);
  const status = await boxOfStatus(page);
  expect(status.bottom).toBeLessThanOrEqual(sections.box.top + touch);
  const pages = await navBox(page, names.pages);
  expect(pages.scrolls).toBe(false);
  expectOneRowOfWholeLinks(pages);
  expect(pages.box.right).toBeLessThanOrEqual(width);
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth).toBeLessThanOrEqual(width);
}

/**
 * Opens one of the System section's pages as the owner would: its entry among the sections, then
 * the page in the section's own nav, whose name is also the page's heading.
 */
export async function openSystemPage(page: Page, names: NavNames, name: string): Promise<void> {
  await page.getByRole("link", { name: names.system }).click();
  await page.getByRole("navigation", { name: names.pages }).getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

/**
 * Pairs a phone's window, then opens a page from its address, so its sections start scrolled to
 * their start. Answers every error or warning the page logs.
 */
export async function openOnAPhone(
  page: Page,
  request: APIRequestContext,
  opened: PhonePage,
): Promise<readonly string[]> {
  await page.setViewportSize({ width: 375, height: 812 });
  const problems = await openPaired(page, request);
  await expect(page.getByRole("navigation", { name: opened.names.sections })).toBeVisible();
  await page.goto(opened.path);
  await expect(page.getByRole("heading", { name: opened.heading, level: 1 })).toBeVisible();
  return problems;
}
