import { expect, test } from "@playwright/test";
import {
  englishNav,
  expectSectionsOnOneLine,
  expectSectionsScrollOnAPhone,
  openOnAPhone,
  openSystemPage,
} from "./smoke-nav";
import { openPaired, shootThemes } from "./smoke-page";

test("puts the sections on one line in a wide window, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await openSystemPage(page, englishNav, "Plugins");
  await expectSectionsOnOneLine(page, englishNav);
  await shootThemes(page, testInfo, "nav-1280");
  expect(problems).toStrictEqual([]);
});

test("scrolls the sections sideways on a phone, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const opened = { names: englishNav, path: "/checks", heading: "Checks" };
  const problems = await openOnAPhone(page, request, opened);
  await expectSectionsScrollOnAPhone(page, englishNav);
  await shootThemes(page, testInfo, "nav-375");
  expect(problems).toStrictEqual([]);
});
